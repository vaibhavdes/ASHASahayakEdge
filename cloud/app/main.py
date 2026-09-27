"""District cloud: sync API for phones and the dashboard."""

import base64
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import numpy as np
from pydantic import BaseModel, Field

from qdrant_client import models
from starlette.background import BackgroundTask

from . import db, demo, embed, outbreak, registry, store
from .config import CACHE, CLOUD, DATA, MODELS, VILLAGES, signal_sentence


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    store.ensure_collections()
    # Fresh container: load the demo district.
    if demo.is_empty():
        demo.seed()
    if db.get_meta("knowledge_version") is None:
        publish_starter_knowledge()
    yield


app = FastAPI(title="Sahayak Edge — district cloud", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


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


def dequantize(q: dict) -> list[float]:
    raw = np.frombuffer(base64.b64decode(q["b"]), dtype=np.int8).astype(np.float32)
    return (raw * (float(q["s"]) / 127.0)).tolist()


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
    # Corrections: ids of anonymous signals the phone withdraws (edited or deleted visits).
    retractions: list[str] = Field(default_factory=list)


# ------------------------------------ sync ------------------------------------


@app.post("/v1/sync/push")
def push(body: PushIn):
    received = db.now_iso()
    signals = [s.model_dump() for s in body.signals]
    for s in signals:
        q = s.pop("vector_q8")
        s["vector"] = dequantize(q) if q else None
    # 2G signals come without a vector; rebuild it from the same template sentence.
    missing = [s for s in signals if not s["vector"]]
    if missing:
        for s, v in zip(missing, embed.dense([signal_sentence(s["syndromes"], s["age_band"]) for s in missing])):
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
def pull(device_id: str, village: str, since: int = 0):
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
def ack(body: AckIn):
    """The phone reports what it holds (for delivery tracking)."""
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


def publish_starter_knowledge():
    k = json.loads((DATA / "knowledge.json").read_text(encoding="utf-8"))
    published = "2026-09-01T00:00:00Z"
    docs = [{**p, "kind": "protocol", "published_at": published, "version": k["version"], "approved_by": None, "expires_at": None} for p in k["protocols"]]
    docs += [{**v, "kind": "answer", "source": "Approved answer", "published_at": published, "version": k["version"], "expires_at": None}
             for a in k["answers"] for v in answer_variants(a)]
    db.put_many(db.DOCS, docs)
    store.upsert_knowledge(docs)
    db.set_meta("knowledge_version", k["version"])


@app.get("/v1/knowledge/docs")
def get_docs():
    return {"version": int(db.get_meta("knowledge_version", 1)), "docs": [{k: v for k, v in d.items() if v is not None} for d in knowledge_docs()]}


@app.get("/v1/knowledge/snapshot")
def get_snapshot(version: int | None = None):
    current = int(db.get_meta("knowledge_version", 1))
    try:
        path = store.knowledge_snapshot(version or current)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


class ManifestIn(BaseModel):
    manifest: dict


@app.post("/v1/knowledge/partial-snapshot")
def partial_snapshot(body: ManifestIn):
    """Build a partial snapshot for one phone from its manifest; the phone then downloads it."""
    try:
        path = store.knowledge_partial_snapshot(body.manifest)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"url": f"/v1/knowledge/snapshot-file/{path.name}"}


@app.get("/v1/knowledge/snapshot-file/{name}")
def snapshot_file(name: str):
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
def publish_doc(doc: DocIn):
    """Publish guidance. Every phone gets it at its next sync (as a Qdrant snapshot)."""
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
def list_questions():
    newest_first = sorted(db.find(db.QUESTIONS), key=lambda q: q["asked_at"], reverse=True)
    return sorted(newest_first, key=lambda q: q["status"] == "answered")[:50]


class AnswerIn(BaseModel):
    text: str
    title: str | None = None
    approved_by: str = "District medical officer"


@app.post("/v1/admin/questions/{question_id}/answer")
def answer_question(question_id: str, body: AnswerIn):
    """Publish a doctor's answer as an approved answer and notify the asking phone."""
    row = db.get(db.QUESTIONS, question_id)
    if not row:
        raise HTTPException(404, "question not found")
    # Placeholders from the phone's name scrubbing read badly in a published answer.
    title = " ".join((body.title or row["question"]).replace("[नाम]", "").replace("[घर]", "").replace("[नंबर]", "").split())
    published = publish_doc(DocIn(kind="answer", title=title, text=body.text, approved_by=body.approved_by, alt_questions=[row["question"]] if title != row["question"] else []))
    db.put(db.QUESTIONS, question_id, {**row, "status": "answered", "answer_title": title, "answer_text": body.text.strip(),
                                         "answered_by": body.approved_by, "answered_at": db.now_iso(), "seq": db.next_seq()})
    return {"ok": True, "knowledge_version": published["version"]}


# ---------------------------------- demo admin --------------------------------


class SimulateIn(BaseModel):
    village: str = "LKP"
    syndromes: list[str] = ["fever", "rash"]
    age_band: str = "0-5"
    count: int = 5


@app.post("/v1/admin/simulate")
def simulate(body: SimulateIn):
    """Signals as if another ASHA's phone synced them (for the stage demo)."""
    week = outbreak.iso_week(datetime.now(timezone.utc))
    sentence = signal_sentence(body.syndromes, body.age_band)
    vector = embed.dense([sentence])[0]
    scale = max(abs(x) for x in vector) or 1.0
    q8 = {"s": scale, "b": base64.b64encode(np.round(np.array(vector) / scale * 127).astype(np.int8).tobytes()).decode()}
    fake = [
        {"id": str(uuid.uuid4()), "village": body.village, "week": week, "age_band": body.age_band, "sex": "F",
         "syndromes": body.syndromes, "danger": False, "sentence": sentence, "vector_q8": q8}
        for _ in range(body.count)
    ]
    return push(PushIn(device_id=f"sim-{body.village}", role="ASHA", village=body.village, signals=[SignalIn(**f) for f in fake]))


class EditIn(BaseModel):
    household_id: str
    field: str
    value: object
    device_id: str = "anm-sunita"


@app.post("/v1/admin/registry/edit")
def registry_edit(body: EditIn):
    """An edit made by another device (the ANM), to demonstrate conflicts."""
    try:
        return registry.edit_as(body.household_id, body.field, body.value, body.device_id)
    except KeyError:
        raise HTTPException(404, "household not found")


@app.post("/v1/admin/reset-live")
def reset_live():
    """Remove demo-time signals and alerts; keep the 8-week history and registry."""
    live = models.Filter(must=[models.FieldCondition(key="source", match=models.MatchValue(value="device"))])
    removed = store.count_signals(live.must)
    store.client.delete(store.SIGNALS, points_selector=models.FilterSelector(filter=live))
    alert_ids = [a["id"] for a in db.find(db.ALERTS)]
    if alert_ids:
        store.client.delete(store.KNOWLEDGE, points_selector=alert_ids)
    for collection in (db.ALERTS, db.DEVICES, db.REPORTS, db.QUESTIONS):
        db.clear(collection)
    return {"removed_signals": removed, "removed_alerts": len(alert_ids)}


# ---------------------------------- dashboard ---------------------------------


@app.get("/v1/dashboard/summary")
def summary():
    live_filter = [models.FieldCondition(key="source", match=models.MatchValue(value="device"))]
    alerts = sorted(db.find(db.ALERTS), key=lambda a: a["created_at"], reverse=True)[:20]
    devices = sorted(db.find(db.DEVICES), key=lambda d: d.get("last_seen", ""), reverse=True)
    # A phone has an alert once it acked a later sequence number.
    for a in alerts:
        targets = [d for d in devices if d.get("village") in a["villages"]]
        a["delivered"] = sum(1 for d in targets if (d.get("acked_seq") or 0) >= a["seq"])
        a["targets"] = len(targets)
    feed = sorted(store.signal_payloads(live_filter), key=lambda x: x.get("received_at", ""), reverse=True)[:25]
    return {
        "villages": VILLAGES,
        "week": outbreak.iso_week(datetime.now(timezone.utc)),
        "zscores": [r for r in outbreak.z_scores() if r["count"] or r["baseline"]],
        "alerts": alerts,
        "devices": devices,
        "feed": feed,
        "totals": {"n": store.count_signals(), "live": store.count_signals(live_filter), "households": db.count(db.HOUSEHOLDS)},
        "reports": sorted(db.find(db.REPORTS), key=lambda r: r["received_at"], reverse=True)[:20],
        "questions": list_questions()[:20],
        "knowledge_version": int(db.get_meta("knowledge_version", 1)),
        "storage": store.storage_mode(),
    }


@app.get("/")
def root():
    return RedirectResponse("/dashboard/")


app.mount("/dashboard", StaticFiles(directory=CLOUD / "dashboard", html=True), name="dashboard")
# Model mirror (scripts/fetch_model.py).
MODELS.mkdir(exist_ok=True)
app.mount("/models", StaticFiles(directory=MODELS), name="models")
