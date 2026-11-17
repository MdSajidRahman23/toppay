import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

for _k in ("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
           "VERCEL", "USER_ID", "USER_PASS"):
    os.environ.pop(_k, None)


@pytest.fixture(autouse=True)
def clean_env(tmp_path, monkeypatch):
    """Every test gets its own empty data file, fixed admin credentials, and fresh in-process caches."""
    monkeypatch.setenv("TOPPAY_DATA_FILE", str(tmp_path / "data.json"))
    monkeypatch.setenv("AUTH_SECRET", "test-secret-" + "x" * 20)
    monkeypatch.setenv("ADMIN_USER", "boss")
    monkeypatch.setenv("ADMIN_PASS", "Boss#Pass1")
    for k in ("USER_ID", "USER_PASS", "VERCEL"):
        monkeypatch.delenv(k, raising=False)
    import auth, policy, sharedlogin, templates_store
    policy.invalidate()
    auth._hits.clear()
    sharedlogin._cache.update(t=0.0, rec=None, fp=None)
    templates_store.invalidate()
    templates_store._cache["v"] = {}
    yield


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    import index
    return TestClient(index.app)


def login(client, user, pw):
    r = client.post("/api/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


@pytest.fixture()
def admin(client):
    return login(client, "boss", "Boss#Pass1")


@pytest.fixture()
def user(client, admin):
    r = client.put("/api/admin/shared-login", json={"username": "reviewer", "password": "shared123"}, headers=admin)
    assert r.status_code == 200, r.text
    return login(client, "reviewer", "shared123")
