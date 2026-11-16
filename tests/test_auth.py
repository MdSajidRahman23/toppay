import time

import pytest
from fastapi.routing import APIRoute

import auth
import sharedlogin
from conftest import login

PUBLIC = {"/api/health", "/api/login"}


def test_health_is_open_and_returns_ok_true(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_every_other_api_route_needs_a_login(client):
    import index
    checked = 0
    for r in index.app.routes:
        if isinstance(r, APIRoute) and r.path.startswith("/api") and r.path not in PUBLIC:
            for m in r.methods - {"HEAD", "OPTIONS"}:
                path = r.path.replace("{tid}", "nid.01")
                resp = client.request(m, path, json={})
                assert resp.status_code == 401, (m, r.path, resp.status_code)
                checked += 1
    assert checked >= 10


def test_admin_login_and_wrong_password(client):
    assert client.post("/api/login", json={"username": "boss", "password": "Boss#Pass1"}).json()["role"] == "admin"
    assert client.post("/api/login", json={"username": "boss", "password": "bad"}).status_code == 401
    assert client.post("/api/login", json={"username": "nobody", "password": "x"}).status_code == 401


def test_no_shared_user_until_admin_sets_one(client, admin):
    assert client.post("/api/login", json={"username": "reviewer", "password": "shared123"}).status_code == 401
    me = client.get("/api/me", headers=admin).json()
    assert any("Shared user" in w for w in me["warnings"])


def test_admin_sets_shared_login_and_users_log_in_as_user(client, admin):
    assert client.put("/api/admin/shared-login", json={"username": "reviewer", "password": "shared123"}, headers=admin).status_code == 200
    r = client.post("/api/login", json={"username": "Reviewer", "password": "shared123"})   # ID is case-insensitive
    assert r.status_code == 200 and r.json()["role"] == "user"
    assert client.get("/api/me", headers={"Authorization": "Bearer " + r.json()["token"]}).json() == {"user": "reviewer", "role": "user"}


def test_exactly_one_shared_user_new_settings_replace_old(client, admin):
    client.put("/api/admin/shared-login", json={"username": "reviewer", "password": "shared123"}, headers=admin)
    client.put("/api/admin/shared-login", json={"username": "team2", "password": "another99"}, headers=admin)
    assert client.post("/api/login", json={"username": "reviewer", "password": "shared123"}).status_code == 401
    assert client.post("/api/login", json={"username": "team2", "password": "another99"}).status_code == 200


def test_changing_the_shared_login_logs_everybody_out(client, admin, user):
    assert client.get("/api/templates", headers=user).status_code == 200
    client.put("/api/admin/shared-login", json={"username": "reviewer", "password": "newpass77"}, headers=admin)
    assert client.get("/api/templates", headers=user).status_code == 401           # old token is dead
    assert client.get("/api/me", headers=admin).status_code == 200                 # admin stays logged in
    assert login(client, "reviewer", "newpass77")


def test_password_hash_is_stored_not_the_password(client, admin, tmp_path):
    client.put("/api/admin/shared-login", json={"username": "reviewer", "password": "shared123"}, headers=admin)
    blob = (tmp_path / "data.json").read_text()
    assert "shared123" not in blob and 'hash' in blob and 'salt' in blob


@pytest.mark.parametrize("name,pw", [("ab", "shared123"), ("bad name", "shared123"), ("reviewer", "123"), ("boss", "shared123"), ("Boss", "shared123")])
def test_shared_login_validation(client, admin, name, pw):
    assert client.put("/api/admin/shared-login", json={"username": name, "password": pw}, headers=admin).status_code == 400


def test_user_cannot_open_admin_routes(client, user):
    assert client.get("/api/admin/shared-login", headers=user).status_code == 403
    assert client.put("/api/admin/shared-login", json={"username": "x_user", "password": "abcdef"}, headers=user).status_code == 403


def test_warnings_only_for_admin(client, admin, user):
    assert "warnings" in client.get("/api/me", headers=admin).json()
    assert "warnings" not in client.get("/api/me", headers=user).json()


def test_env_fallback_for_shared_user(client, monkeypatch):
    monkeypatch.setenv("USER_ID", "envuser")
    monkeypatch.setenv("USER_PASS", "envpass1")
    sharedlogin._cache.update(t=0.0, rec=None, fp=None)
    assert client.post("/api/login", json={"username": "envuser", "password": "envpass1"}).json()["role"] == "user"
    assert client.post("/api/login", json={"username": "envuser", "password": "x"}).status_code == 401


def test_panel_setting_beats_env(client, admin, monkeypatch):
    monkeypatch.setenv("USER_ID", "envuser"); monkeypatch.setenv("USER_PASS", "envpass1")
    client.put("/api/admin/shared-login", json={"username": "panel1", "password": "panelpw1"}, headers=admin)
    assert client.post("/api/login", json={"username": "envuser", "password": "envpass1"}).status_code == 401
    assert client.post("/api/login", json={"username": "panel1", "password": "panelpw1"}).status_code == 200


def test_changing_env_password_kills_old_tokens(client, monkeypatch):
    monkeypatch.setenv("USER_ID", "envuser"); monkeypatch.setenv("USER_PASS", "envpass1")
    sharedlogin._cache.update(t=0.0, rec=None, fp=None)
    h = login(client, "envuser", "envpass1")
    monkeypatch.setenv("USER_PASS", "different1")
    sharedlogin._cache.update(t=0.0, rec=None, fp=None)
    assert client.get("/api/me", headers=h).status_code == 401


def test_changing_admin_password_kills_admin_token(client, admin, monkeypatch):
    monkeypatch.setenv("ADMIN_PASS", "Another#1")
    assert client.get("/api/me", headers=admin).status_code == 401


def test_expired_token_is_refused(client, admin, monkeypatch):
    real = time.time
    monkeypatch.setattr(auth.time, "time", lambda: real() + auth.TOKEN_TTL + 5)
    assert client.get("/api/me", headers=admin).status_code == 401


def test_tampered_token_is_refused(client, user):
    import base64, json
    tok = user["Authorization"].split()[1]
    payload, sig = tok.split(".")
    data = json.loads(base64.urlsafe_b64decode(payload + "=="))
    data["r"] = "admin"
    forged = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=") + "." + sig
    assert client.get("/api/admin/shared-login", headers={"Authorization": "Bearer " + forged}).status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Basic abc"}).status_code == 401


def test_login_is_rate_limited(client):
    codes = [client.post("/api/login", json={"username": "boss", "password": "no"}).status_code for _ in range(10)]
    assert 429 in codes
