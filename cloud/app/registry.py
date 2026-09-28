"""Household registry with per-field versions (optimistic concurrency)."""

from fastapi import HTTPException

from . import db

FIELDS = {"head", "phone", "members", "pregnant_member", "edd", "high_risk"}


def apply_changes(item: dict, device_id: str) -> tuple[list[dict], list[dict]]:
    accepted, conflicts = [], []
    record = db.get(db.HOUSEHOLDS, item["id"])
    if record and record["village"] != item["village"]:
        raise HTTPException(403, "household belongs to another area")
    if not set(item.get("changes", {})).issubset(FIELDS):
        raise HTTPException(400, "invalid registry field")
    record = record or {k: item.get(k) for k in ("village", "ward", "house_no", "lat", "lon")}
    fields = record.get("fields", {})
    for name, change in item.get("changes", {}).items():
        cur = fields.get(name)
        value, base = change["value"], change.get("base", 0)
        if cur is None or cur["ts"] == base:
            ts = (cur["ts"] if cur else 0) + 1
            fields[name] = {"value": value, "ts": ts, "dev": device_id}
            accepted.append({"household_id": item["id"], "field": name, "ts": ts})
        elif cur["value"] == value:
            accepted.append({"household_id": item["id"], "field": name, "ts": cur["ts"]})
        else:
            conflicts.append({"household_id": item["id"], "field": name, "theirs": cur["value"], "theirs_ts": cur["ts"], "theirs_dev": cur["dev"]})
    record["fields"] = fields
    record["seq"] = db.next_seq()
    db.put(db.HOUSEHOLDS, item["id"], record)
    return accepted, conflicts


def changed_since(village: str, since: int) -> list[dict]:
    rows = db.find(db.HOUSEHOLDS, [db.eq("village", village), db.gt("seq", since)])
    return [{k: v for k, v in r.items() if k != "seq"} for r in rows]

