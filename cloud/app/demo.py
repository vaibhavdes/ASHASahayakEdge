"""Demo district: eight weeks of history signals and the household registry."""

import json

from . import db, embed, registry, store
from .config import DATA, signal_sentence


def seed():
    history = json.loads((DATA / "out" / "history_signals.json").read_text())
    sentences = sorted({signal_sentence(s["syndromes"], s["age_band"]) for s in history})
    vectors = dict(zip(sentences, embed.dense(sentences)))
    for s in history:
        s["sentence"] = signal_sentence(s["syndromes"], s["age_band"])
        s["vector"] = vectors[s["sentence"]]
        s["received_at"] = s["at"]
    for i in range(0, len(history), 256):
        store.add_signals(history[i : i + 256])
    households = json.loads((DATA / "out" / "demo_households.json").read_text())
    registry.seed([h for village in households.values() for h in village])
    return len(history), sum(len(v) for v in households.values())


def is_empty() -> bool:
    return db.count(db.HOUSEHOLDS) == 0
