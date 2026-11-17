"""Admin-editable policy + Quality Indicators."""
import pytest
from conftest import login
import indicators, policy, templates_store as ts
from rules_engine import evaluate_application


def keys(res):
    return {r["key"] for r in res["reasons"]}


BASE = {"customer_age": 30, "profession": "businessman", "mrp": 30000, "tx_1_month": 2500}


def test_every_indicator_template_exists_and_reject_is_english():
    for kind, groups in indicators.INDICATORS.items():
        for _cat, items in groups:
            for _n, _label, tid in items:
                assert ts.meta(tid), tid
                assert ts.meta(tid)["kind"] == kind, (tid, kind)
                if kind == "reject":
                    assert not ts._BN.search(ts.effective_text(tid)), tid


def test_indicator_counts_match_the_sheet():
    r = indicators.INDICATORS["return"]
    assert [len(i) for _, i in r] == [7, 7, 2, 5]
    j = indicators.INDICATORS["reject"]
    assert [len(i) for _, i in j] == [6, 5, 5, 10]


def test_templates_api_returns_indicators(client, admin):
    out = client.get("/api/templates", headers=admin).json()
    assert out["indicators"]["return"][0]["category"] == "Statement Issue"
    assert out["indicators"]["reject"][3]["items"][9]["label"].startswith("Customer rude")


def test_defaults_do_not_change_behaviour():
    assert evaluate_application(BASE)["status"] != "RETURNED"
    assert "tx_month" in keys(evaluate_application({**BASE, "tx_1_month": 1500}))


def test_admin_changes_min_amount_and_engine_follows(client, admin):
    r = client.put("/api/admin/policy", json={"values": {"min_month_tx": 3000}}, headers=admin)
    assert r.status_code == 200, r.text
    assert "tx_month" in keys(evaluate_application({**BASE, "tx_1_month": 2500}))      # 2,500 < 3,000-60
    assert "tx_month" not in keys(evaluate_application({**BASE, "tx_1_month": 2950}))  # tolerance still applies
    client.post("/api/admin/policy/reset", json={"keys": None}, headers=admin)
    assert "tx_month" not in keys(evaluate_application({**BASE, "tx_1_month": 2500}))


def test_admin_changes_age_limits(client, admin):
    client.put("/api/admin/policy", json={"values": {"customer_age_max": 55}}, headers=admin)
    assert "customer_age" in keys(evaluate_application({**BASE, "customer_age": 60}))
    client.put("/api/admin/policy", json={"values": {"guarantor_age_min": 25}}, headers=admin)
    assert any(k.startswith("g_age") or "guarantor_age" in k for k in keys(evaluate_application({**BASE, "guarantor_age": 23})))


def test_high_mrp_and_fast_track_and_first_blood_are_editable(client, admin):
    d = {"customer_age": 30, "profession": "job_holder", "mrp": 60000, "tx_1_month": 7000, "tx_3_month": 16000, "down_payment_pct": 0}
    client.put("/api/admin/policy", json={"values": {"high_mrp": 70000}}, headers=admin)
    assert "tx3_15k" not in keys(evaluate_application({**d, "tx_3_month": 1000}))        # 60,000 is no longer "high"
    client.put("/api/admin/policy", json={"values": {"fast_track_tx": 8000}}, headers=admin)
    assert not evaluate_application(d)["fast_track"]
    client.put("/api/admin/policy", json={"values": {"first_blood": ["father"]}}, headers=admin)
    out = evaluate_application({**BASE, "name_mismatch": True, "guarantor_relation": "mother"})
    assert "g_not_family" in keys(out)


def test_not_served_category_can_be_switched_off(client, admin):
    d = {**BASE, "profession": "media_press"}
    assert "not_served:customer" in keys(evaluate_application(d))
    client.put("/api/admin/policy", json={"values": {"not_served": ["lawyer"]}}, headers=admin)
    assert "not_served:customer" not in keys(evaluate_application(d))


def test_validation_and_permissions(client, admin, user):
    bad = [{"customer_age_min": 70}, {"min_month_tx": -5}, {"fast_track_tx": 100}, {"nope": 1}, {"business_start": 18},
           {"dp40_short_guarantor_call": "yes"}, {"weekend_days": ["9"]}]
    for v in bad:
        assert client.put("/api/admin/policy", json={"values": v}, headers=admin).status_code == 400, v
    assert client.put("/api/admin/policy", json={"values": {}}, headers=admin).status_code == 400
    assert client.put("/api/admin/policy", json={"values": {"min_month_tx": 2100}}, headers=user).status_code == 403
    assert client.get("/api/policy", headers=user).json()["spec"] is None            # users see values only
    assert client.put("/api/admin/policy", json={"values": {"min_month_tx": 2100}}).status_code == 401


def test_log_and_template_placeholders_follow_policy(client, admin):
    client.put("/api/admin/policy", json={"values": {"guarantor_age_min": 23, "guarantor_age_max": 60}}, headers=admin)
    info = client.get("/api/policy", headers=admin).json()
    assert info["log"][0]["by"] and info["log"][0]["changes"]["guarantor_age_min"] == [21, 23]
    ctx = client.get("/api/templates", headers=admin).json()["context"]
    assert ctx["g_age_min"] == 23 and ctx["g_age_max"] == 60
