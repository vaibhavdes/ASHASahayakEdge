"""Small backend contract test for an empty evaluator workspace and two phones."""

import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from qdrant_client import QdrantClient
from app import db, main, store


class EvaluatorFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.qdrant = QdrantClient(path=self.tmp.name)
        db.client = store.client = self.qdrant
        db.IS_CLOUD = store.IS_CLOUD = False
        db.init()
        store.ensure_collections()
        db.set_meta("knowledge_version", 1)
        main.ENROLL_CODE = "test-enrollment-code"
        main.ADMIN_TOKEN = "test-admin-token"
        self.api = TestClient(main.app)

    def tearDown(self):
        self.api.close()
        self.qdrant.close()
        self.tmp.cleanup()

    def enroll(self, device, area):
        r = self.api.post("/v1/enroll", json={"device_id": device, "role": "ASHA", "village": area, "code": main.ENROLL_CODE})
        self.assertEqual(r.status_code, 200, r.text)
        return {"Authorization": f"Bearer {r.json()['token']}"}

    def test_empty_workspace_two_phones_scope_conflict_and_guidance(self):
        self.assertEqual(self.api.get("/v1/dashboard/summary").status_code, 401)
        admin = {"Authorization": "Bearer test-admin-token"}
        self.assertEqual(self.api.get("/v1/dashboard/summary", headers=admin).json()["totals"]["households"], 0)
        a, b, other = self.enroll("phone-a", "MDH"), self.enroll("phone-b", "MDH"), self.enroll("phone-c", "MBD")
        changes = {"head": {"value": "Fictional Asha", "base": 0}, "members": {"value": [{"id": "member-1", "name": "Fictional Meera", "age": 25, "sex": "F"}], "base": 0}}
        request = {"device_id": "phone-a", "role": "ASHA", "village": "MDH", "households": [{"id": "family-1", "village": "MDH", "ward": "MDH", "house_no": "B4", "changes": changes}]}
        r = self.api.post("/v1/sync/push", json=request, headers=a)
        self.assertEqual(r.status_code, 200, r.text)
        pulled = self.api.get("/v1/sync/pull", params={"device_id": "phone-b", "village": "MDH", "since": 0}, headers=b)
        self.assertEqual(pulled.status_code, 200)
        self.assertEqual(pulled.json()["households"][0]["fields"]["head"]["value"], "Fictional Asha")
        self.assertGreater(pulled.json()["seq"], 0)
        self.assertEqual(self.api.get("/v1/sync/pull", params={"device_id": "phone-c", "village": "MDH", "since": 0}, headers=other).status_code, 403)
        self.assertEqual(self.api.post("/v1/sync/push", json=request, headers=b).status_code, 403)
        r = self.api.post("/v1/sync/push", headers=b, json={"device_id": "phone-b", "role": "ASHA", "village": "MDH", "households": [{"id": "family-1", "village": "MDH", "changes": {"head": {"value": "Fictional revised", "base": 1}}}]})
        self.assertEqual(r.status_code, 200)
        r = self.api.post("/v1/sync/push", headers=a, json={"device_id": "phone-a", "role": "ASHA", "village": "MDH", "households": [{"id": "family-1", "village": "MDH", "changes": {"head": {"value": "Different edit", "base": 1}}}]})
        self.assertEqual(len(r.json()["households"]["conflicts"]), 1)
        signal_id = str(uuid.uuid4())
        signal = {"id": signal_id, "village": "MDH", "week": "2026-W39", "age_band": "15-49", "sex": "F", "syndromes": ["fever"], "danger": False, "sentence": "Private name that must not be stored"}
        r = self.api.post("/v1/sync/push", headers=a, json={"device_id": "phone-a", "role": "ASHA", "village": "MDH", "signals": [signal]})
        self.assertEqual(r.status_code, 200, r.text)
        point = store.client.retrieve(store.SIGNALS, [signal_id], with_payload=True)[0].payload
        self.assertNotIn("Private name", point["sentence"])
        self.assertEqual(point["device_id"], "phone-a")
        self.assertEqual(self.api.post("/v1/sync/push", headers=b, json={"device_id": "phone-b", "role": "ASHA", "village": "MDH", "retractions": [signal_id]}).status_code, 403)
        guidance = self.api.post("/v1/admin/knowledge", headers=admin, json={"title": "Review fever reports", "text": "Assess and refer if danger signs appear."})
        self.assertEqual(guidance.status_code, 200, guidance.text)
        self.assertEqual(self.api.get("/v1/sync/pull", params={"device_id": "phone-b", "village": "MDH", "since": 0}, headers=b).json()["knowledge_version"], 2)
        self.assertEqual(self.api.post("/v1/admin/reset-live", headers=admin).status_code, 404)


if __name__ == "__main__":
    unittest.main()
