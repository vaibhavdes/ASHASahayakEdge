"""Outbreak radar: weekly count anomalies per village and similar signals across villages."""

import math
import uuid
from datetime import datetime, timedelta, timezone

from qdrant_client import models

from . import db, store
from .config import ALERT_RADIUS_KM, MIN_CASES, SYNDROMES, VILLAGES, ZSCORE_THRESHOLD

VILLAGE = {v["code"]: v for v in VILLAGES}
ACTIONS = {
    "fever": "Check for danger signs, test for malaria where advised, report to ANM if cases keep rising.",
    "rash": "Suspected measles if with fever: report every case, check MR vaccination of children nearby.",
    "diarrhoea": "Promote ORS + zinc, check drinking-water sources, report bloody stools and deaths immediately.",
    "cough_2w": "Refer for free sputum test (NTEP).",
    "jaundice": "Possible contaminated water: advise boiled water, refer for testing, inform ANM.",
    "danger_pregnancy": "Ensure referral and transport; ANM to follow up today.",
    "danger_newborn": "Ensure referral; ANM to follow up today.",
}


def iso_week(d: datetime) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def km(a: dict, b: dict) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def nearby(codes: list[str]) -> list[str]:
    """Target every village within ALERT_RADIUS_KM of any affected village."""
    return sorted({v["code"] for v in VILLAGES for c in codes if km(v, VILLAGE[c]) <= ALERT_RADIUS_KM})


def label(s: str) -> str:
    d = SYNDROMES.get(s)
    return f"{d['label_en']} ({d['label_hi']})" if d else s


def week_counts(weeks: list[str]) -> dict[tuple[str, str, str], int]:
    """Signals per village, syndrome and week, read from the Qdrant signals collection."""
    counts: dict[tuple[str, str, str], int] = {}
    rows = store.signal_payloads([models.FieldCondition(key="week", match=models.MatchAny(any=weeks))])
    for row in rows:
        syns = set(row["syndromes"])
        # Fever with rash is one pattern (suspected measles), not two separate rises.
        keys = (syns - {"fever", "rash"}) | {"fever+rash"} if {"fever", "rash"} <= syns else syns
        for s in keys:
            k = (row["village"], s, row["week"])
            counts[k] = counts.get(k, 0) + 1
    return counts


def create_alert(*, kind, title, text, severity, villages, syndromes, dedupe, days=10) -> dict | None:
    if db.count(db.ALERTS, [db.eq("dedupe", dedupe)]):
        return None
    now = datetime.now(timezone.utc)
    alert = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "title": title,
        "text": text,
        "severity": severity,
        "villages": villages,
        "syndromes": syndromes,
        "created_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    db.put(db.ALERTS, alert["id"], {**alert, "dedupe": dedupe, "seq": db.next_seq()})
    return alert


def z_scores() -> list[dict]:
    now = datetime.now(timezone.utc)
    current = iso_week(now)
    past = [iso_week(now - timedelta(weeks=w)) for w in range(1, 9)]
    counts = week_counts([current, *past])
    out = []
    keys = {(v, s) for (v, s, _w) in counts}
    for village, syndrome in keys:
        n = counts.get((village, syndrome, current), 0)
        history = [counts.get((village, syndrome, w), 0) for w in past]
        mean = sum(history) / len(history)
        std = math.sqrt(sum((x - mean) ** 2 for x in history) / len(history))
        z = (n - mean) / max(std, 1.0)
        out.append({"village": village, "syndrome": syndrome, "week": current, "count": n, "baseline": round(mean, 1), "z": round(z, 2)})
    return out


def scan() -> list[dict]:
    created = []
    # 1. Count anomalies.
    for r in z_scores():
        if r["count"] >= MIN_CASES and r["z"] >= ZSCORE_THRESHOLD and not r["syndrome"].startswith("danger"):
            syn = r["syndrome"]
            parts = syn.split("+")
            name = VILLAGE[r["village"]]["name"]
            action = " ".join(ACTIONS.get(p, "") for p in parts).strip()
            a = create_alert(
                kind="count",
                title=f"{' + '.join(label(p) for p in parts)} rising in {name}",
                text=f"{r['count']} cases this week in {name} vs usual {r['baseline']} (z={r['z']}). {action}",
                severity="alert",
                villages=nearby([r["village"]]),
                syndromes=parts,
                dedupe=f"count:{r['village']}:{syn}:{r['week']}",
            )
            if a:
                created.append(a)

    # 2. Cross-village semantic clusters over the last 14 days.
    since = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
    pairs = store.similar_pairs(since, threshold=0.92)
    if pairs:
        info = {str(p.id): p.payload for p in store.recent_signals(since)}
        parent: dict[str, str] = {}

        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a, b, _ in pairs:
            parent[find(a)] = find(b)
        groups: dict[str, list[str]] = {}
        for x in parent:
            groups.setdefault(find(x), []).append(x)
        for members in groups.values():
            rows = [info[m] for m in members if m in info]
            villages = sorted({r["village"] for r in rows})
            if len(rows) < 4 or len(villages) < 2:
                continue
            syns = sorted({s for r in rows for s in r["syndromes"]})
            names = ", ".join(VILLAGE[v]["name"] for v in villages)
            action = " ".join(ACTIONS.get(s, "") for s in syns).strip()
            a = create_alert(
                kind="cluster",
                title=f"Similar illness across {names}",
                text=f"{len(rows)} similar reports ({', '.join(label(s) for s in syns)}) in {len(villages)} villages in 14 days. {action}",
                severity="alert",
                villages=nearby(villages),
                syndromes=syns,
                dedupe=f"cluster:{'|'.join(villages)}:{'|'.join(syns)}:{iso_week(datetime.now(timezone.utc))}",
            )
            if a:
                created.append(a)
    for a in created:
        store.upsert_knowledge([{
            "id": a["id"], "kind": "alert", "title": a["title"], "text": a["text"], "source": "District surveillance",
            "severity": a["severity"], "villages": a["villages"], "topic": ",".join(a["syndromes"]),
            "published_at": a["created_at"], "expires_at": a["expires_at"],
        }])
    return created


def danger_notice(signal: dict) -> dict | None:
    """An urgent danger sign goes to its own village's devices (the ANM follows up)."""
    name = VILLAGE.get(signal["village"], {}).get("name", signal["village"])
    syns = [s for s in signal["syndromes"] if s.startswith("danger")]
    return create_alert(
        kind="danger",
        title=f"Danger sign reported in {name}",
        text=f"{', '.join(label(s) for s in syns)} (age {signal['age_band']}) reported on {signal.get('date', signal['week'])}. {ACTIONS.get(syns[0], '') if syns else ''}",
        severity="watch",
        villages=[signal["village"]],
        syndromes=syns,
        dedupe=f"danger:{signal['id']}",
        days=3,
    )
