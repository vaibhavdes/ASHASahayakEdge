"""Load the demo district (history signals, registry, starter guidance).

    cd cloud && python -m scripts.seed
"""

from app import db, demo, store
from app.main import publish_starter_knowledge

if __name__ == "__main__":
    db.init()
    store.ensure_collections()
    signals, households = demo.seed()
    publish_starter_knowledge()
    print(f"{signals} history signals, {households} households, guidance v{db.get_meta('knowledge_version')} ({store.storage_mode()})")
    store.client.close()
