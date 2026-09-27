"""Explicit sample scenario only: history signals, registry and starter guidance.

    cd cloud && COLLECTION_PREFIX=sample1_ SAHAYAK_SAMPLE_SCENARIO=1 python -m scripts.seed
"""

import os

from app import db, demo, store
from app.config import COLLECTION_PREFIX
from app.main import publish_starter_knowledge

if __name__ == "__main__":
    if os.getenv("SAHAYAK_SAMPLE_SCENARIO") != "1" or not COLLECTION_PREFIX.startswith("sample"):
        raise SystemExit("This loads fictional historical records. Set SAHAYAK_SAMPLE_SCENARIO=1 and use a sample* collection prefix.")
    db.init()
    store.ensure_collections()
    if not demo.is_empty():
        raise SystemExit("Sample scenario already contains families; refusing to overwrite it.")
    signals, households = demo.seed()
    publish_starter_knowledge()
    print(f"SAMPLE SCENARIO in {COLLECTION_PREFIX}*: {signals} fictional historical signals, {households} fictional households, guidance v{db.get_meta('knowledge_version')} ({store.storage_mode()})")
    store.client.close()
