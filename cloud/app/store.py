"""Qdrant access. `signals`: anonymous signals. `knowledge`: guidance, same layout as the phone shard."""

import uuid
from pathlib import Path

import httpx
import numpy as np
from qdrant_client import QdrantClient, models

from . import embed
from .config import CACHE, LOCAL_QDRANT, NORMALIZER, QDRANT_API_KEY, QDRANT_URL

SIGNALS = "signals"
KNOWLEDGE = "knowledge"

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=60) if QDRANT_URL else QdrantClient(path=str(LOCAL_QDRANT))
IS_CLOUD = bool(QDRANT_URL)

INDEXES = {
    SIGNALS: {
        "village": models.PayloadSchemaType.KEYWORD,
        "week": models.PayloadSchemaType.KEYWORD,
        "syndromes": models.PayloadSchemaType.KEYWORD,
        "danger": models.PayloadSchemaType.BOOL,
        "source": models.PayloadSchemaType.KEYWORD,
        "at": models.PayloadSchemaType.DATETIME,
    },
    KNOWLEDGE: {
        "kind": models.PayloadSchemaType.KEYWORD,
        "villages": models.PayloadSchemaType.KEYWORD,
        "severity": models.PayloadSchemaType.KEYWORD,
        "topic": models.PayloadSchemaType.KEYWORD,
        "published_at": models.PayloadSchemaType.DATETIME,
        "expires_at": models.PayloadSchemaType.DATETIME,
    },
}


def ensure_collections():
    existing = {c.name for c in client.get_collections().collections}
    if SIGNALS not in existing:
        client.create_collection(
            SIGNALS,
            vectors_config={"dense": models.VectorParams(size=embed.DIM, distance=models.Distance.COSINE)},
            shard_number=1,
        )
    if KNOWLEDGE not in existing:
        # Mirrors the phone's shard config (app/src-tauri/src/edge.rs).
        client.create_collection(
            KNOWLEDGE,
            vectors_config={
                "dense": models.VectorParams(
                    size=embed.DIM,
                    distance=models.Distance.COSINE,
                    on_disk=True,
                    quantization_config=models.ScalarQuantization(
                        scalar=models.ScalarQuantizationConfig(type=models.ScalarType.INT8, quantile=0.99)
                    ),
                )
            },
            sparse_vectors_config={"bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)},
            on_disk_payload=True,
            shard_number=1,
        )
    if IS_CLOUD:
        for collection, fields in INDEXES.items():
            for field, schema in fields.items():
                client.create_payload_index(collection, field, field_schema=schema)


# ------------------------------- signals -------------------------------


def add_signals(signals: list[dict]):
    if not signals:
        return
    client.upsert(
        SIGNALS,
        points=[
            models.PointStruct(
                id=s["id"],
                vector={"dense": s["vector"]},
                payload={k: v for k, v in s.items() if k != "vector"},
            )
            for s in signals
        ],
    )


def signal_payloads(must: list, must_not: list | None = None) -> list[dict]:
    """All signal records matching a filter, payload only (for counting and the feed)."""
    flt = models.Filter(must=must or None, must_not=must_not or None)
    out, offset = [], None
    while True:
        points, offset = client.scroll(SIGNALS, scroll_filter=flt, limit=1000, offset=offset, with_payload=True, with_vectors=False)
        out += [p.payload for p in points]
        if offset is None:
            return out


def count_signals(must: list | None = None) -> int:
    return client.count(SIGNALS, count_filter=models.Filter(must=must or None), exact=True).count


def recent_signals(since_iso: str, limit: int = 2000) -> list[models.Record]:
    flt = models.Filter(
        must=[models.FieldCondition(key="at", range=models.DatetimeRange(gte=since_iso))],
        must_not=[models.FieldCondition(key="source", match=models.MatchValue(value="history"))],
    )
    points, _ = client.scroll(SIGNALS, scroll_filter=flt, limit=limit, with_vectors=["dense"], with_payload=True)
    return points


def similar_pairs(since_iso: str, threshold: float) -> list[tuple[str, str, float]]:
    """Pairs of similar recent signals (distance matrix on Qdrant Cloud, NumPy locally)."""
    flt = models.Filter(
        must=[models.FieldCondition(key="at", range=models.DatetimeRange(gte=since_iso))],
        must_not=[models.FieldCondition(key="source", match=models.MatchValue(value="history"))],
    )
    if IS_CLOUD:
        res = client.search_matrix_pairs(SIGNALS, query_filter=flt, sample=500, limit=10, using="dense")
        return [(str(p.a), str(p.b), p.score) for p in res.pairs if p.score >= threshold]
    points = recent_signals(since_iso)
    if len(points) < 2:
        return []
    ids = [str(p.id) for p in points]
    m = np.array([p.vector["dense"] for p in points], dtype=np.float32)
    m /= np.linalg.norm(m, axis=1, keepdims=True)
    sims = m @ m.T
    return [(ids[i], ids[j], float(sims[i, j])) for i in range(len(ids)) for j in range(i + 1, len(ids)) if sims[i, j] >= threshold]


# ------------------------------ knowledge ------------------------------


def upsert_knowledge(docs: list[dict]):
    if not docs:
        return
    # Must match embedText in app/src/lib/knowledge.ts.
    texts = [
        NORMALIZER.expand(NORMALIZER.question_core(d.get("question") or d["title"])) if d.get("kind") == "answer" else NORMALIZER.expand(f"{d['title']}. {d['text']}")
        for d in docs
    ]
    vectors = embed.dense(texts)
    client.upsert(
        KNOWLEDGE,
        points=[
            models.PointStruct(
                id=d["id"],
                vector={"dense": v, "bm25": embed.sparse(t)},
                payload={k: val for k, val in d.items() if k != "id"},
            )
            for d, v, t in zip(docs, vectors, texts)
        ],
    )


def knowledge_snapshot(version: int) -> Path:
    """Full shard snapshot of `knowledge`, cached per version."""
    if not IS_CLOUD:
        raise RuntimeError("snapshots need Qdrant Cloud (local development mode has none)")
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"knowledge-v{version}.snapshot"
    if path.exists():
        return path
    headers = {"api-key": QDRANT_API_KEY} if QDRANT_API_KEY else {}
    base = QDRANT_URL.rstrip("/")
    with httpx.Client(timeout=120, headers=headers) as http:
        r = http.post(f"{base}/collections/{KNOWLEDGE}/shards/0/snapshots", params={"wait": "true"})
        r.raise_for_status()
        name = r.json()["result"]["name"]
        with http.stream("GET", f"{base}/collections/{KNOWLEDGE}/shards/0/snapshots/{name}") as resp:
            resp.raise_for_status()
            tmp = path.with_suffix(".part")
            with open(tmp, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
            tmp.rename(path)
        http.delete(f"{base}/collections/{KNOWLEDGE}/shards/0/snapshots/{name}")
    for old in CACHE.glob("knowledge-v*.snapshot"):
        if old != path:
            old.unlink()
    return path


def knowledge_partial_snapshot(manifest: dict) -> Path:
    """Partial snapshot for a phone, built from its segment manifest."""
    if not IS_CLOUD:
        raise RuntimeError("partial snapshots need Qdrant Cloud (local development mode has none)")
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"partial-{uuid.uuid4().hex}.snapshot"
    headers = {"api-key": QDRANT_API_KEY} if QDRANT_API_KEY else {}
    url = f"{QDRANT_URL.rstrip('/')}/collections/{KNOWLEDGE}/shards/0/snapshot/partial/create"
    with httpx.Client(timeout=120, headers=headers) as http:
        with http.stream("POST", url, json=manifest) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
    return path


def delete_signals(ids: list[str]):
    if ids:
        client.delete(SIGNALS, points_selector=ids)


def storage_mode() -> str:
    return "Qdrant Cloud" if IS_CLOUD else "local Qdrant (development)"
