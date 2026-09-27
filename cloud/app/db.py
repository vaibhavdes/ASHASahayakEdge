"""Records in Qdrant, no SQL: registry, alerts, devices, reports, questions,
guidance documents and counters. Each record is a payload-only point."""

import threading
import uuid
from datetime import datetime, timezone

from qdrant_client import models

from .store import IS_CLOUD, client

HOUSEHOLDS = "registry"
ALERTS = "alerts"
DEVICES = "devices"
REPORTS = "reports"
QUESTIONS = "questions"
DOCS = "guidance_docs"
META = "meta"

K, I = models.PayloadSchemaType.KEYWORD, models.PayloadSchemaType.INTEGER
INDEXES = {
    HOUSEHOLDS: {"village": K, "seq": I},
    ALERTS: {"dedupe": K, "villages": K, "seq": I},
    DEVICES: {"village": K},
    REPORTS: {"village": K},
    QUESTIONS: {"device_id": K, "status": K, "seq": I},
    DOCS: {"kind": K},
    META: {},
}

_seq_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init():
    existing = {c.name for c in client.get_collections().collections}
    for name, fields in INDEXES.items():
        if name not in existing:
            client.create_collection(name, vectors_config={})
        if IS_CLOUD:
            for field, schema in fields.items():
                client.create_payload_index(name, field, field_schema=schema)


def _pid(key: str) -> str:
    try:
        return str(uuid.UUID(key))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


# ------------------------------ conditions ------------------------------

def eq(key, value):
    return models.FieldCondition(key=key, match=models.MatchValue(value=value))


def gt(key, value):
    return models.FieldCondition(key=key, range=models.Range(gt=value))


# -------------------------------- records --------------------------------

def put(collection: str, key: str, record: dict):
    client.upsert(collection, [models.PointStruct(id=_pid(key), vector={}, payload={**record, "id": key})])


def put_many(collection: str, records: list[dict], key: str = "id"):
    for i in range(0, len(records), 256):
        batch = records[i : i + 256]
        client.upsert(collection, [models.PointStruct(id=_pid(r[key]), vector={}, payload=r) for r in batch])


def get(collection: str, key: str) -> dict | None:
    found = client.retrieve(collection, [_pid(key)], with_payload=True)
    return found[0].payload if found else None


def find(collection: str, must: list | None = None, must_not: list | None = None) -> list[dict]:
    flt = models.Filter(must=must or None, must_not=must_not or None)
    out, offset = [], None
    while True:
        points, offset = client.scroll(collection, scroll_filter=flt, limit=500, offset=offset, with_payload=True)
        out += [p.payload for p in points]
        if offset is None:
            return out


def count(collection: str, must: list | None = None) -> int:
    return client.count(collection, count_filter=models.Filter(must=must or None), exact=True).count


def delete(collection: str, keys: list[str]):
    if keys:
        client.delete(collection, points_selector=[_pid(k) for k in keys])


def clear(collection: str):
    client.delete_collection(collection)
    client.create_collection(collection, vectors_config={})
    if IS_CLOUD:
        for field, schema in INDEXES[collection].items():
            client.create_payload_index(collection, field, field_schema=schema)


# ------------------------------ counters ------------------------------

def get_meta(key: str, default=None):
    record = get(META, key)
    return record["value"] if record else default


def set_meta(key: str, value):
    put(META, key, {"value": value})


def next_seq() -> int:
    """Monotonic sequence for pull (the service runs as one instance)."""
    with _seq_lock:
        seq = int(get_meta("seq", 0)) + 1
        set_meta("seq", seq)
        return seq


def current_seq() -> int:
    return int(get_meta("seq", 0))
