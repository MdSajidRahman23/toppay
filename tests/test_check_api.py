from conftest import login

BASE = {"customer_age": 30, "profession": "job_holder", "mrp": 40000, "tx_1_month": 5000}


def post(client, h, data=None, manual=(), dismissed=()):
    r = client.post("/api/check", json={"data": {**BASE, **(data or {})}, "manual": [{"tid": t} for t in manual],
                                        "dismissed": list(dismissed)}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_check_needs_login(client):
    assert client.post("/api/check", json={"data": {}}).status_code == 401


def test_response_shape_is_the_v2_contract(client, user):
    out = post(client, user)
    assert out["api_version"] == 2 and out["status"] == "APPROVED"
    assert set(out) >= {"status", "status_detail", "reasons", "passed", "notes", "missing", "fast_track", "fast_track_msg", "context", "data"}
    assert out["context"]["m3"]


def test_automatic_reason_has_resolved_text_and_rule(client, user):
    out = post(client, user, {"tx_1_month": 1000})
    r = next(x for x in out["reasons"] if x["id"] == "tx_month")
    assert r["source"] == "auto" and r["kind"] == "return" and r["tid"] == "stm.24" and not r["dismissed"]
    assert "{m3}" not in r["text"] and r["template"].count("{m3}") == 1
    assert "যে কোন এক মাসে" in r["text"] and r["why"]


def test_manual_reject_forces_rejected(client, user):
    out = post(client, user, manual=["rej.05"])
    assert out["status"] == "REJECTED / SUSPECTED FRAUD"
    m = next(x for x in out["reasons"] if x["source"] == "manual")
    assert m["id"] == "manual:rej.05" and m["kind"] == "reject" and "fake and AI-generated" in m["text"]


def test_manual_return_forces_at_least_returned_even_with_missing_info(client, user):
    out = client.post("/api/check", json={"data": {"mrp": 30000}, "manual": [{"tid": "nid.01"}]}, headers=user).json()
    assert out["missing"] and out["status"] == "RETURNED"


def test_dismissing_an_automatic_reason_keeps_it_visible_but_not_counted(client, user):
    out = post(client, user, {"is_nid_edited": True}, dismissed=["flag:is_nid_edited"])
    assert out["status"] == "APPROVED"
    r = next(x for x in out["reasons"] if x["id"] == "flag:is_nid_edited")
    assert r["dismissed"] is True and r["text"]
    assert out["status_detail"]["dismissed"] == ["flag:is_nid_edited"]


def test_manual_plus_dismiss_combination(client, user):
    out = post(client, user, {"is_nid_edited": True, "guarantor_age": 70}, manual=["nid.01"], dismissed=["flag:is_nid_edited"])
    assert out["status"] == "RETURNED" and out["status_detail"]["active"] == {"reject": 0, "return": 2, "action": 0}


def test_unknown_hidden_and_duplicate_manual_templates_are_ignored(client, admin, user):
    client.post("/api/templates/nid.01/hidden", json={"hidden": True}, headers=admin)
    out = post(client, user, manual=["zzz.99", "nid.01", "nid.03", "nid.03"])
    ids = [r["id"] for r in out["reasons"] if r["source"] == "manual"]
    assert ids == ["manual:nid.03"]


def test_months_placeholder_is_filled_in_manual_picker_templates(client, user):
    out = post(client, user, manual=["stm.01"])
    m = next(x for x in out["reasons"] if x["id"] == "manual:stm.01")
    assert "{m3}" not in m["text"] and "{m3}" in m["template"]


def test_unknown_placeholders_stay_for_the_browser_to_fill(client, user):
    out = post(client, user, manual=["rej.01"])
    m = next(x for x in out["reasons"] if x["id"] == "manual:rej.01")
    assert "{holder}" in m["text"]


def test_not_served_reject_params_resolved(client, user):
    out = post(client, user, {"profession": "lawyer"})
    r = next(x for x in out["reasons"] if x["id"] == "not_served:customer")
    assert r["text"] == "Customer is in a NOT SERVED category: Lawyer."


def test_internal_notes_never_become_bp_text(client, user):
    out = post(client, user, {"repeat_customer": True, "down_payment_pct": 40, "tx_1_month": 7000})
    assert out["fast_track"] and out["notes"]
    for r in out["reasons"]:
        assert not r["text"] or "Fast-Track" not in r["text"]


def test_no_customer_data_is_written_to_the_store(client, user, tmp_path):
    post(client, user, {"mrp": 77777, "customer_age": 41.5, "tx_1_month": 4321})
    blob = (tmp_path / "data.json").read_text()
    assert "77777" not in blob and "4321" not in blob and "41.5" not in blob


def test_analyze_is_still_login_protected(client):
    assert client.post("/api/analyze", json={"text": "x"}).status_code == 401


def test_reviewer_can_add_any_template_as_return_or_reject(client, user):
    def kinds(tid, kind):
        out = client.post("/api/check", json={"data": BASE, "manual": [{"tid": tid, "kind": kind}]}, headers=user).json()
        return next(r for r in out["reasons"] if r["source"] == "manual")["kind"], out["status"]
    assert kinds("nid.01", "return") == ("return", "RETURNED")
    assert kinds("rej.05", "return") == ("return", "RETURNED")              # an English reject text as a return reason
    assert kinds("rej.05", "reject") == ("reject", "REJECTED / SUSPECTED FRAUD")
    assert kinds("nid.01", "reject") == ("return", "RETURNED")              # Bangla text can never be a reject reason
    assert kinds("nid.01", None) == ("return", "RETURNED")
    assert kinds("rej.05", "nonsense") == ("reject", "REJECTED / SUSPECTED FRAUD")
