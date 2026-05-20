from fastapi.testclient import TestClient

from drishti_ml.main import app


def test_healthz_returns_ok():
    client = TestClient(app)
    res = client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "drishti-ml"
    assert "version" in body
