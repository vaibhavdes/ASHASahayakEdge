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


def seed(households: list[dict]):
    """Explicit sample scenario only. Assign sequences so a second phone can pull it."""

    def v(value):
        return {"value": value, "ts": 1, "dev": "registry"}

    db.put_many(db.HOUSEHOLDS, [
        {
            "id": h["id"], "village": h["village"], "ward": h["ward"], "house_no": h["house_no"], "lat": h["lat"], "lon": h["lon"], "seq": db.next_seq(),
            "fields": {
                "head": v(h["head"]), "phone": v(h["phone"]), "members": v(h["members"]),
                "pregnant_member": v(h["pregnant_member"]), "edd": v(None), "high_risk": v(False),
            },
        }
        for h in households
    ])


def edit_as(household_id: str, field: str, value, device_id: str) -> dict:
    """An edit made on another device (the ANM), used to demonstrate conflicts."""
    record = db.get(db.HOUSEHOLDS, household_id)
    if not record:
        raise KeyError(household_id)
    cur = record["fields"].get(field, {"ts": 0})
    record["fields"][field] = {"value": value, "ts": cur["ts"] + 1, "dev": device_id}
    record["seq"] = db.next_seq()
    db.put(db.HOUSEHOLDS, household_id, record)
    return record["fields"][field]
