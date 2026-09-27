"""Same embeddings as the phone: multilingual MiniLM (dense) and Qdrant Edge BM25 (sparse)."""

import os
from functools import lru_cache

from fastembed import TextEmbedding
from qdrant_client import models
from qdrant_edge import Bm25, Bm25Config, DisabledStemmer, TokenizerType

MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DIM = 384


@lru_cache(maxsize=1)
def _dense_model() -> TextEmbedding:
    return TextEmbedding(MODEL, cache_dir=os.getenv("MODEL_CACHE"))


@lru_cache(maxsize=1)
def _bm25() -> Bm25:
    return Bm25(Bm25Config(tokenizer=TokenizerType.Multilingual, lowercase=True, stemmer=DisabledStemmer()))


def dense(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _dense_model().embed(texts)]


def sparse(text: str) -> models.SparseVector:
    v = _bm25().embed_document(text)
    return models.SparseVector(indices=list(v.indices), values=list(v.values))
