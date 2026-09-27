"""Search benchmark for Sahayak Edge.

Runs the same query design the phone uses (Qdrant Edge: dense + BM25, RRF fusion,
recency formula) on the synthetic visit notes, and compares retrieval modes.

    pip install qdrant-edge-py fastembed
    python data/generate.py
    python eval/bench.py
"""

import json
import math
import shutil
import sys
import time
from pathlib import Path

from fastembed import TextEmbedding
from qdrant_edge import (
    Bm25,
    Bm25Config,
    DisabledStemmer,
    Distance,
    EdgeConfig,
    EdgeShard,
    EdgeSparseVectorParams,
    EdgeVectorParams,
    Fusion,
    Modifier,
    Point,
    Prefetch,
    Query,
    QueryRequest,
    SparseVector,
    TokenizerType,
    UpdateOperation,
)

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))
from normalize import Normalizer  # noqa: E402

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
K = 5
PARAPHRASE_FROM = 24  # queries after this index share no words with the notes


def relevant(visit, rule):
    truth = visit["truth"]
    if "scenario" in rule and truth["scenario"] not in rule["scenario"]:
        return False
    if "syndromes_any" in rule and not set(rule["syndromes_any"]) & set(truth["syndromes"]):
        return False
    if "syndromes_all" in rule and not set(rule["syndromes_all"]) <= set(truth["syndromes"]):
        return False
    if "age_band" in rule and visit["age_band"] not in rule["age_band"]:
        return False
    return True


def build_shard(path, visits, dense_vecs, bm25, normalizer, docs):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    config = EdgeConfig(
        vectors={"dense": EdgeVectorParams(size=384, distance=Distance.Cosine)},
        sparse_vectors={"bm25": EdgeSparseVectorParams(modifier=Modifier.Idf)},
    )
    shard = EdgeShard.create(str(path), config)
    points = []
    for i, (v, dv) in enumerate(zip(visits, dense_vecs)):
        sparse = bm25.embed_document(docs[i])
        points.append(Point(i, {"dense": dv.tolist(), "bm25": sparse}, {"i": i}))
    shard.update(UpdateOperation.upsert_points(points))
    shard.optimize()
    return shard


def prefetch(query, using, limit):
    return Prefetch(prefetches=[], query=Query.Nearest(query, using=using), limit=limit,
                    params=None, filter=None, score_threshold=None)


def run_query(shard, mode, dense, sparse, limit):
    if mode == "dense":
        req = QueryRequest(prefetches=[], query=Query.Nearest(dense, using="dense"), filter=None,
                           score_threshold=None, limit=limit, offset=0, params=None,
                           with_vector=False, with_payload=True)
    elif mode == "bm25":
        req = QueryRequest(prefetches=[], query=Query.Nearest(sparse, using="bm25"), filter=None,
                           score_threshold=None, limit=limit, offset=0, params=None,
                           with_vector=False, with_payload=True)
    else:
        weights = {"hybrid": None, "hybrid_d2": [2.0, 1.0], "hybrid_s2": [1.0, 2.0]}[mode]
        req = QueryRequest(prefetches=[prefetch(dense, "dense", 30), prefetch(sparse, "bm25", 30)],
                           query=Fusion.Rrf(k=60, weights=weights), filter=None, score_threshold=None, limit=limit,
                           offset=0, params=None, with_vector=False, with_payload=True)
    return shard.query(req)


def metrics(ranked_rel, total_rel):
    hits = sum(ranked_rel[:K])
    precision = hits / K
    recall = hits / min(total_rel, K) if total_rel else 0
    mrr = next((1 / (i + 1) for i, r in enumerate(ranked_rel) if r), 0)
    dcg = sum(r / math.log2(i + 2) for i, r in enumerate(ranked_rel[:K]))
    idcg = sum(1 / math.log2(i + 2) for i in range(min(total_rel, K)))
    return precision, recall, mrr, dcg / idcg if idcg else 0


def main():
    visits = json.loads((ROOT / "data/out/demo_visits.json").read_text())
    visits = visits["RMP"] + visits["LKP"]
    queries = json.loads((ROOT / "data/out/eval_queries.json").read_text())
    normalizer = Normalizer.from_file(ROOT / "data/lexicon.json")

    print(f"Embedding {len(visits)} notes with {MODEL} ...")
    model = TextEmbedding(MODEL)
    bm25 = Bm25(Bm25Config(tokenizer=TokenizerType.Multilingual, stemmer=DisabledStemmer()))

    lexicon = json.loads((ROOT / "data/lexicon.json").read_text())
    signal_words = {k: v for k, v in lexicon["signal_words"].items() if not k.startswith("_")}

    def enriched(v, norm):
        # "What you embed matters": the note plus what the phone already knows about
        # it (tags from the lexicon rules, age group, pregnancy), like adding the
        # product category to a product title.
        terms = norm.canonical_terms(v["text"])
        syndromes = [s for s, d in lexicon["syndromes"].items()
                     if all(t in terms for t in d["all"]) and (not d.get("any") or any(t in terms for t in d["any"]))]
        tags = [signal_words.get(s, s) for s in syndromes]
        context = ["pregnant woman" if v["pregnant"] else "", "child" if v["age_band"] in ("0-5", "6-14") else "adult"]
        return f"{norm.expand(v['text'])} | {' '.join(tags)} {' '.join(c for c in context if c)}"

    results = {}
    for variant in ("raw", "normalised", "normalised+tags"):
        norm = normalizer if variant != "raw" else Normalizer({})
        docs = [enriched(v, norm) if variant == "normalised+tags" else norm.expand(v["text"]) for v in visits]
        dense = list(model.embed(docs))
        shard = build_shard(ROOT / f"eval/.shard_{variant.replace('+', '_')}", visits, dense, bm25, norm, docs)
        for mode in ("dense", "bm25", "hybrid", "hybrid_d2", "hybrid_s2"):
            scores, latencies = [], []
            for qi, q in enumerate(queries):
                text = norm.expand(q["q"])
                qd = next(model.query_embed(text)).tolist()
                qs = bm25.embed_query(text)
                t0 = time.perf_counter()
                hits = run_query(shard, mode, qd, qs, 20)
                latencies.append((time.perf_counter() - t0) * 1000)
                ranked = [relevant(visits[h.payload["i"]], q["rel"]) for h in hits]
                total = sum(relevant(v, q["rel"]) for v in visits)
                scores.append(metrics(ranked, total))
            avg = [sum(s[i] for s in scores) / len(scores) for i in range(4)]
            para = scores[PARAPHRASE_FROM:]
            para_p = sum(s[0] for s in para) / len(para)
            results[(variant, mode)] = avg + [para_p, sorted(latencies)[len(latencies) // 2]]
        shard.close()

    print(f"\n{'variant':<16} {'mode':<10} {'P@5':>6} {'R@5':>6} {'MRR':>6} {'nDCG@5':>7} {'para P@5':>9} {'p50 ms':>7}")
    for (variant, mode), (p, r, mrr, ndcg, para, lat) in results.items():
        print(f"{variant:<16} {mode:<10} {p:6.3f} {r:6.3f} {mrr:6.3f} {ndcg:7.3f} {para:9.3f} {lat:7.2f}")
    (ROOT / "eval/results.json").write_text(json.dumps(
        {f"{v}/{m}": dict(zip(["p@5", "r@5", "mrr", "ndcg@5", "paraphrase_p@5", "p50_ms"], vals)) for (v, m), vals in results.items()},
        indent=1))


if __name__ == "__main__":
    main()
