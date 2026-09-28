"""District cloud: sync API for phones and the dashboard."""

import hashlib
import hmac
import json
import re
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from qdrant_client import models
from starlette.background import BackgroundTask

from . import db, embed, outbreak, registry, store
from .config import ADMIN_TOKEN, ALERT_RADIUS_KM, CACHE, CLOUD, DATA, ENROLL_CODE, ENROLL_PER_IP_HOUR, OPEN_DASHBOARD, OPEN_ENROLLMENT, SYNDROMES, VILLAGES, signal_sentence


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    store.ensure_collections()
    publish_starter_knowledge()
    yield


app = FastAPI(title="Sahayak Edge — district cloud", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])


def _bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "device or admin token required")
    return authorization[7:]


def device_auth(token: str = Depends(_bearer)) -> dict:
    digest = hashlib.sha256(token.encode()).hexdigest()
    device = db.get(db.AUTH, digest)
    if not device:
        raise HTTPException(401, "invalid device token")
    return device


def admin_auth(authorization: str | None = Header(default=None)) -> None:
    if OPEN_DASHBOARD:
        return
    token = _bearer(authorization)
    if not ADMIN_TOKEN or not hmac.compare_digest(token, ADMIN_TOKEN):
        raise HTTPException(401, "invalid admin token")


class EnrollIn(BaseModel):
    device_id: str
    role: str
    village: str
    code: str = ""


# Enrollments per client address in the current hour. One instance, so memory is enough.
_enrolled_by_ip: dict[tuple[str, str], int] = {}


def client_ip(request: Request) -> str:
    # Cloud Run appends the real client address to X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


@app.get("/v1/enroll")
def enroll_mode():
    return {"code_required": not OPEN_ENROLLMENT}


@app.post("/v1/enroll")
def enroll(body: EnrollIn, request: Request):
    if not OPEN_ENROLLMENT and (not ENROLL_CODE or not hmac.compare_digest(body.code, ENROLL_CODE)):
        raise HTTPException(401, "invalid enrollment code")
    key = (client_ip(request), datetime.now(timezone.utc).strftime("%Y%m%d%H"))
    if _enrolled_by_ip.get(key, 0) >= ENROLL_PER_IP_HOUR:
        raise HTTPException(429, "too many phones registered from this network, try again later")
    if len(_enrolled_by_ip) > 10_000:
        _enrolled_by_ip.clear()
    _enrolled_by_ip[key] = _enrolled_by_ip.get(key, 0) + 1
    if body.village not in {v["code"] for v in VILLAGES} or body.role not in ("ASHA", "ANM"):
        raise HTTPException(400, "invalid area or role")
    # A device receives its own random bearer token; the shared code is never used for sync.
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    db.put(db.AUTH, digest, {"device_id": body.device_id, "village": body.village, "role": body.role, "enrolled_at": db.now_iso()})
    return {"token": token}


def same_device(device: dict, device_id: str, village: str, role: str | None = None):
    if device["device_id"] != device_id or device["village"] != village or (role and device["role"] != role):
        raise HTTPException(403, "device is not assigned to this area")


# ----------------------------------- models -----------------------------------


class SignalIn(BaseModel):
    id: str
    village: str
    week: str
    date: str | None = None
    age_band: str
    sex: str | None = None
    syndromes: list[str]
    danger: bool = False
    sentence: str
    vector_q8: dict | None = None  # {"s": scale, "b": base64 int8}; omitted on 2G


class HouseholdIn(BaseModel):
    id: str
    village: str
    ward: str | None = None
    house_no: str | None = None
    lat: float | None = None
    lon: float | None = None
    changes: dict[str, dict]


class ReportIn(BaseModel):
    id: str
    kind: str  # "s_form" | "monthly"
    village: str
    period: str
    data: dict | list
    model_config = {"extra": "allow"}


class QuestionIn(BaseModel):
    id: str
    village: str
    question: str
    asked_at: str


class PushIn(BaseModel):
    device_id: str
    role: str = "ASHA"
    village: str
    signals: list[SignalIn] = Field(default_factory=list)
    households: list[HouseholdIn] = Field(default_factory=list)
    reports: list[ReportIn] = Field(default_factory=list)
    questions: list[QuestionIn] = Field(default_factory=list)
    # Corrections: ids of device-linked symptom reports withdrawn after edited or deleted visits.
    retractions: list[str] = Field(default_factory=list)


# ------------------------------------ sync ------------------------------------


@app.post("/v1/sync/push")
def push(body: PushIn, device: dict = Depends(device_auth)):
    same_device(device, body.device_id, body.village, body.role)
    if any(x.village != body.village for x in (*body.signals, *body.households, *body.reports, *body.questions)):
        raise HTTPException(403, "cross-area upload rejected")
    for signal in body.signals:
        if (not signal.syndromes or len(signal.syndromes) > 3 or not set(signal.syndromes).issubset(SYNDROMES)
                or signal.age_band not in ("0-5", "6-14", "15-49", "50+") or signal.sex not in ("M", "F", None)
                or not re.fullmatch(r"\d{4}-W\d{2}", signal.week)
                or (signal.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", signal.date))):
            raise HTTPException(400, "invalid symptom signal")
    for signal_id in body.retractions:
        point = store.client.retrieve(store.SIGNALS, [signal_id], with_payload=True)
        if point and point[0].payload.get("device_id") != body.device_id:
            raise HTTPException(403, "cannot retract another device's signal")
    for signal in body.signals:
        point = store.client.retrieve(store.SIGNALS, [signal.id], with_payload=True)
        if point and point[0].payload.get("device_id") != body.device_id:
            raise HTTPException(403, "signal id belongs to another device")
    received = db.now_iso()
    signals = [s.model_dump() for s in body.signals]
    for s in signals:
        s.pop("vector_q8")
        s["sentence"] = signal_sentence(s["syndromes"], s["age_band"])
    # Never persist arbitrary client text or vectors in the surveillance collection.
    if signals:
        for s, v in zip(signals, embed.dense([s["sentence"] for s in signals])):
            s["vector"] = v
    for s in signals:
        s["at"] = f"{s['date']}T12:00:00Z" if s.get("date") else received
        s["source"] = "device"
        s["device_id"] = body.device_id
        s["received_at"] = received
        s["bytes"] = len(json.dumps({k: v for k, v in s.items() if k != "vector"}))
    store.add_signals(signals)

    danger_alerts = [a for s in signals if s["danger"] and (a := outbreak.danger_notice(s))]
    accepted_h, conflicts = [], []
    for h in body.households:
        acc, conf = registry.apply_changes(h.model_dump(), body.device_id)
        accepted_h += acc
        conflicts += conf
    # Reports carry counts only; a re-submitted period replaces the earlier one.
    for r in body.reports:
        db.put(db.REPORTS, r.id, {**r.model_dump(), "device_id": body.device_id, "received_at": received})
    for q in body.questions:
        if not db.get(db.QUESTIONS, q.id):
            db.put(db.QUESTIONS, q.id, {**q.model_dump(), "device_id": body.device_id, "status": "open", "seq": 0})
    device = db.get(db.DEVICES, body.device_id) or {"pushed": 0}
    db.put(db.DEVICES, body.device_id, {**device, "role": body.role, "village": body.village, "last_seen": received, "pushed": device.get("pushed", 0) + len(signals)})
    store.delete_signals(body.retractions)
    created = outbreak.scan()
    return {
        "accepted_retractions": body.retractions,
        "accepted_signals": [s["id"] for s in signals],
        "accepted_reports": [r.id for r in body.reports],
        "accepted_questions": [q.id for q in body.questions],
        "households": {"accepted": accepted_h, "conflicts": conflicts},
        "alerts_created": len(created) + len(danger_alerts),
    }


@app.get("/v1/sync/pull")
def pull(device_id: str, village: str, since: int = 0, device: dict = Depends(device_auth)):
    same_device(device, device_id, village)
    seq = db.current_seq()
    alerts = sorted(db.find(db.ALERTS, [db.eq("villages", village), db.gt("seq", since)]), key=lambda a: a["seq"])
    answers = db.find(db.QUESTIONS, [db.eq("device_id", device_id), db.eq("status", "answered"), db.gt("seq", since)])
    device = db.get(db.DEVICES, device_id)
    if device:
        db.put(db.DEVICES, device_id, {**device, "last_seen": db.now_iso()})
    return {
        "seq": seq,
        "alerts": [{k: a[k] for k in ("id", "title", "text", "severity", "villages", "syndromes", "created_at", "expires_at")} for a in alerts],
        "households": registry.changed_since(village, since),
        "answers": [{"question_id": q["id"], "title": q["answer_title"], "text": q["answer_text"], "answered_at": q["answered_at"]} for q in answers],
        "knowledge_version": int(db.get_meta("knowledge_version", 1)),
    }


class AckIn(BaseModel):
    device_id: str
    role: str = "ASHA"
    village: str
    knowledge_version: int
    seq: int
    pending: int = 0


@app.post("/v1/sync/ack")
def ack(body: AckIn, device: dict = Depends(device_auth)):
    """The phone reports what it holds (for delivery tracking)."""
    same_device(device, body.device_id, body.village, body.role)
    now = db.now_iso()
    device = db.get(db.DEVICES, body.device_id) or {"pushed": 0}
    db.put(db.DEVICES, body.device_id, {**device, "role": body.role, "village": body.village, "last_seen": now,
                                          "knowledge_version": body.knowledge_version, "acked_seq": body.seq, "pending": body.pending, "last_ack": now})
    return {"ok": True}


# --------------------------------- knowledge ----------------------------------


def knowledge_docs() -> list[dict]:
    return sorted(db.find(db.DOCS), key=lambda d: d["published_at"])


def answer_variants(a: dict) -> list[dict]:
    """One point per approved phrasing (same ids as app/src/lib/knowledge.ts answerVariants)."""
    base = {k: v for k, v in a.items() if k != "alt_questions"}
    out = []
    for i, question in enumerate([a["title"], *a.get("alt_questions", [])]):
        vid = a["id"] if i == 0 else f"{a['id'][:8]}-{i:04d}{a['id'][13:]}"
        out.append({**base, "id": vid, "question": question})
    return out


# Must match STARTER_SOURCE in app/src/lib/starter.ts.
STARTER_SOURCE = "Starter guidance (MoHFW/WHO summary)"


def publish_starter_knowledge():
    """Publish bundled guidance when it is new or its version changed; district additions are kept."""
    k = json.loads((DATA / "knowledge.json").read_text(encoding="utf-8"))
    if db.get_meta("starter_version") == k["version"]:
        return
    published = "2026-09-01T00:00:00Z"
    docs = [{**p, "kind": "protocol", "published_at": published, "version": k["version"], "approved_by": None, "expires_at": None} for p in k["protocols"]]
    docs += [{**v, "kind": "answer", "source": STARTER_SOURCE, "published_at": published, "version": k["version"], "expires_at": None}
             for a in k["answers"] for v in answer_variants(a)]
    db.put_many(db.DOCS, docs)
    store.upsert_knowledge(docs)
    current = db.get_meta("knowledge_version")
    db.set_meta("knowledge_version", k["version"] if current is None else int(current) + 1)
    db.set_meta("starter_version", k["version"])


@app.get("/v1/knowledge/docs")
def get_docs(_device: dict = Depends(device_auth)):
    return {"version": int(db.get_meta("knowledge_version", 1)), "docs": [{k: v for k, v in d.items() if v is not None} for d in knowledge_docs()]}


@app.get("/v1/knowledge/snapshot")
def get_snapshot(version: int | None = None, _device: dict = Depends(device_auth)):
    current = int(db.get_meta("knowledge_version", 1))
    try:
        path = store.knowledge_snapshot(version or current)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


class ManifestIn(BaseModel):
    manifest: dict


@app.post("/v1/knowledge/partial-snapshot")
def partial_snapshot(body: ManifestIn, _device: dict = Depends(device_auth)):
    """Build a partial snapshot for one phone from its manifest; the phone then downloads it."""
    try:
        path = store.knowledge_partial_snapshot(body.manifest)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"url": f"/v1/knowledge/snapshot-file/{path.name}"}


@app.get("/v1/knowledge/snapshot-file/{name}")
def snapshot_file(name: str, _device: dict = Depends(device_auth)):
    path = CACHE / name
    if not name.startswith("partial-") or not name.endswith(".snapshot") or not path.exists():
        raise HTTPException(404, "snapshot not found")
    # Partial snapshots are per phone; remove once handed out.
    return FileResponse(path, media_type="application/octet-stream", filename=name, background=BackgroundTask(path.unlink))


class DocIn(BaseModel):
    kind: str = "protocol"  # "protocol" | "answer"
    title: str
    text: str
    topic: str | None = None
    source: str = "District health office"
    approved_by: str | None = None
    alt_questions: list[str] = Field(default_factory=list)
    expires_in_days: int | None = None


@app.post("/v1/admin/knowledge")
def publish_doc(doc: DocIn, _admin: None = Depends(admin_auth)):
    """Publish guidance. Every phone gets it at its next sync (as a Qdrant snapshot)."""
    if doc.kind not in ("protocol", "answer"):
        raise HTTPException(400, "kind must be protocol or answer")
    if not doc.title.strip() or not doc.text.strip():
        raise HTTPException(400, "title and text are required")
    if doc.expires_in_days is not None and doc.expires_in_days < 0:
        raise HTTPException(400, "expires_in_days cannot be negative")
    version = int(db.get_meta("knowledge_version", 1)) + 1
    now = datetime.now(timezone.utc)
    base = {
        "id": str(uuid.uuid4()),
        "kind": doc.kind,
        "title": doc.title.strip(),
        "text": doc.text.strip(),
        "source": doc.source if doc.kind != "answer" else "Approved answer",
        "topic": doc.topic,
        "approved_by": doc.approved_by,
        "published_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + timedelta(days=doc.expires_in_days)).strftime("%Y-%m-%dT%H:%M:%SZ") if doc.expires_in_days else None,
        "version": version,
    }
    docs = answer_variants({**base, "alt_questions": [q for q in doc.alt_questions if q.strip()]}) if doc.kind == "answer" else [base]
    db.put_many(db.DOCS, docs)
    store.upsert_knowledge(docs)
    db.set_meta("knowledge_version", version)
    return {"version": version, "id": base["id"], "points": len(docs)}


@app.get("/v1/admin/questions")
def list_questions(_admin: None = Depends(admin_auth)):
    newest_first = sorted(db.find(db.QUESTIONS), key=lambda q: q["asked_at"], reverse=True)
    return sorted(newest_first, key=lambda q: q["status"] == "answered")[:50]


class AnswerIn(BaseModel):
    text: str
    title: str | None = None
    approved_by: str = "District doctor"


@app.post("/v1/admin/questions/{question_id}/answer")
def answer_question(question_id: str, body: AnswerIn, _admin: None = Depends(admin_auth)):
    """Publish a doctor's answer as an approved answer and notify the asking phone."""
    row = db.get(db.QUESTIONS, question_id)
    if not row:
        raise HTTPException(404, "question not found")
    if not body.text.strip():
        raise HTTPException(400, "answer text is required")
    body.approved_by = body.approved_by.strip() or "District doctor"
    # Placeholders from the phone's name scrubbing read badly in a published answer.
    title = " ".join((body.title or row["question"]).replace("[नाम]", "").replace("[घर]", "").replace("[नंबर]", "").split())
    published = publish_doc(DocIn(kind="answer", title=title, text=body.text, approved_by=body.approved_by, alt_questions=[row["question"]] if title != row["question"] else []), _admin)
    db.put(db.QUESTIONS, question_id, {**row, "status": "answered", "answer_title": title, "answer_text": body.text.strip(),
                                         "answered_by": body.approved_by, "answered_at": db.now_iso(), "seq": db.next_seq()})
    return {"ok": True, "knowledge_version": published["version"]}


# ---------------------------------- dashboard ---------------------------------


_summary_pool = ThreadPoolExecutor(max_workers=10)


@app.get("/v1/dashboard/summary")
def summary(_admin: None = Depends(admin_auth)):
    live_filter = [models.FieldCondition(key="source", match=models.MatchValue(value="device"))]
    jobs = {
        "alerts": lambda: db.find(db.ALERTS),
        "devices": lambda: db.find(db.DEVICES),
        "feed": lambda: store.signal_payloads(live_filter),
        "zscores": outbreak.z_scores,
        "n": store.count_signals,
        "live": lambda: store.count_signals(live_filter),
        "households": lambda: db.count(db.HOUSEHOLDS),
        "reports": lambda: db.find(db.REPORTS),
        "questions": lambda: list_questions(None),
        "version": lambda: int(db.get_meta("knowledge_version", 1)),
    }
    # Each read is a round trip to Qdrant Cloud, so run them side by side there.
    if store.IS_CLOUD:
        futures = {k: _summary_pool.submit(f) for k, f in jobs.items()}
        got = {k: f.result() for k, f in futures.items()}
    else:
        got = {k: f() for k, f in jobs.items()}
    alerts = sorted(got["alerts"], key=lambda a: a["created_at"], reverse=True)[:20]
    devices = sorted(got["devices"], key=lambda d: d.get("last_seen", ""), reverse=True)
    # A phone has an alert once it acked a later sequence number.
    for a in alerts:
        targets = [d for d in devices if d.get("village") in a["villages"]]
        a["delivered"] = sum(1 for d in targets if (d.get("acked_seq") or 0) >= a["seq"])
        a["targets"] = len(targets)
    feed = sorted(got["feed"], key=lambda x: x.get("received_at", ""), reverse=True)[:25]
    return {
        "villages": VILLAGES,
        "syndromes": {k: v["label_en"] for k, v in SYNDROMES.items()},
        "alert_radius_km": ALERT_RADIUS_KM,
        "week": outbreak.iso_week(datetime.now(timezone.utc)),
        "zscores": [{**r, "unusual": outbreak.unusual(r)} for r in got["zscores"] if r["count"] or r["baseline"]],
        "alerts": alerts,
        "devices": devices,
        "feed": feed,
        "totals": {"n": got["n"], "live": got["live"], "households": got["households"]},
        "reports": sorted(got["reports"], key=lambda r: r["received_at"], reverse=True)[:20],
        "questions": got["questions"][:20],
        "knowledge_version": got["version"],
        "storage": store.storage_mode(),
    }


@app.get("/")
def root():
    return RedirectResponse("/dashboard/")


app.mount("/dashboard", StaticFiles(directory=CLOUD / "dashboard", html=True), name="dashboard")
