import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

CLOUD = Path(__file__).resolve().parent.parent
ROOT = CLOUD.parent
DATA = ROOT / "data"
load_dotenv(CLOUD / ".env")

# Shared with the app and the benchmark.
sys.path.insert(0, str(DATA))
from normalize import Normalizer  # noqa: E402

QDRANT_URL = os.getenv("QDRANT_URL", "").strip()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "").strip() or None
COLLECTION_PREFIX = os.getenv("COLLECTION_PREFIX", "eval1_").strip()
if not COLLECTION_PREFIX or not all(c.isalnum() or c == "_" for c in COLLECTION_PREFIX):
    raise ValueError("COLLECTION_PREFIX must contain only letters, numbers and underscores")
ENROLL_CODE = os.getenv("ENROLL_CODE", "").strip()
# Open enrollment: any phone registers itself; the code is only checked when this is off.
OPEN_ENROLLMENT = os.getenv("OPEN_ENROLLMENT", "false").lower() in ("1", "true", "yes")
ENROLL_PER_IP_HOUR = int(os.getenv("ENROLL_PER_IP_HOUR", "30"))
# Open dashboard: the district dashboard and its admin actions need no token (for open trials).
OPEN_DASHBOARD = os.getenv("OPEN_DASHBOARD", "false").lower() in ("1", "true", "yes")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
ZSCORE_THRESHOLD = float(os.getenv("ZSCORE_THRESHOLD", "2.0"))
MIN_CASES = int(os.getenv("MIN_CASES", "3"))
ALERT_RADIUS_KM = float(os.getenv("ALERT_RADIUS_KM", "6"))

LOCAL_QDRANT = CLOUD / ".qdrant"
CACHE = CLOUD / ".cache"

LEXICON = json.loads((DATA / "lexicon.json").read_text(encoding="utf-8"))
VILLAGES = json.loads((DATA / "villages.json").read_text(encoding="utf-8"))
NORMALIZER = Normalizer(LEXICON["terms"], LEXICON.get("question_frame"))
SIGNAL_WORDS = {k: v for k, v in LEXICON["signal_words"].items() if not k.startswith("_")}
SYNDROMES = LEXICON["syndromes"]


def signal_sentence(syndromes: list[str], age_band: str) -> str:
    """Same fixed, PII-free sentence the phone builds (app/src/lib/policy.ts)."""
    return f"{', '.join(SIGNAL_WORDS.get(s, s) for s in syndromes)} | age {age_band}"
