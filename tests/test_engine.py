import pytest

from rules_engine import (CONFIG, FLAG_TID, REJECT_FLAGS, STATUS_APPROVED, STATUS_NEED_INFO, STATUS_RETURNED,
                          STATUS_REJECTED, TID, evaluate_application, find_missing)
from templates_data import BUILTIN

BASE = {"customer_age": 30, "profession": "job_holder", "mrp": 40000, "tx_1_month": 5000}


def keys(res, kind=None):
    return [r["key"] for r in res["reasons"] if kind is None or r["kind"] == kind]


def ev(**kw):
    d = dict(BASE); d.update(kw)
    return evaluate_application(d)


# ---------------------------------------------------------------- SOP: 2,000 rule (cash-in OR cash-out, margin 60)
@pytest.mark.parametrize("amount,ok", [(2000, True), (1940, True), (1939, False), (1500, False), (5000, True)])
def test_best_month_threshold_with_60_taka_margin(amount, ok):
    r = ev(tx_1_month=amount)
    assert ("tx_month" not in keys(r)) is ok
    assert r["status"] == (STATUS_APPROVED if ok else STATUS_RETURNED)


def test_margin_is_60_not_100():
    assert CONFIG["money_tolerance"] == 60
    assert "tx_month" in keys(ev(tx_1_month=1900))     # 100 short is NOT accepted any more


def test_three_month_total_no_longer_rescues_a_low_best_month():
    """Old code used 3-month total / 3 as a floor (cash-in + cash-out added). SOP says each direction alone."""
    r = ev(tx_1_month=1500, tx_3_month=9000)
    assert "tx_month" in keys(r)
    assert r["status"] == STATUS_RETURNED


def test_tx3_alone_does_not_satisfy_the_month_rule():
    r = evaluate_application({"customer_age": 30, "profession": "job_holder", "mrp": 40000, "tx_3_month": 90000})
    assert "tx_month" not in keys(r)           # nothing to judge yet ...
    assert any(m[0] == "tx_1_month" for m in r["missing"])   # ... so it asks for the best month
    assert r["status"] == STATUS_NEED_INFO


def test_fast_track_from_6000_with_margin():
    assert ev(tx_1_month=6000)["fast_track"] is True
    assert ev(tx_1_month=5940)["fast_track"] is True
    assert ev(tx_1_month=5939)["fast_track"] is False


def test_margin_note_is_internal_and_mentions_taka():
    r = ev(tx_1_month=1960)
    assert any("short of 2,000" in n for n in r["notes"])
    assert "tx_month" not in keys(r)


@pytest.mark.parametrize("months,returned", [(3, False), (2, True), (1, True), (0, True)])
def test_statement_must_cover_three_months(months, returned):
    r = ev(stmt_months_covered=months)
    assert ("stmt_not_3_months" in keys(r, "return")) is returned
    if returned:
        assert [x for x in r["reasons"] if x["key"] == "stmt_not_3_months"][0]["tid"] == TID["stmt_not_3_months"]


# ---------------------------------------------------------------- ages
@pytest.mark.parametrize("age,expect", [(30, None), (18.6, None), (18.4, "customer_age"), (62.4, None), (62.6, "customer_age")])
def test_customer_age(age, expect):
    r = ev(customer_age=age)
    assert (expect in keys(r, "reject")) if expect else ("customer_age" not in keys(r))


def test_customer_age_reject_has_params_and_english_template():
    r = ev(customer_age=70)
    x = [a for a in r["reasons"] if a["key"] == "customer_age"][0]
    assert x["kind"] == "reject" and x["tid"] == "rej.31" and x["params"]["range"] == "19-62"
    assert r["status"] == STATUS_REJECTED


@pytest.mark.parametrize("age,tid", [(65, "gua.02"), (20, "gua.04")])
def test_guarantor_age_return(age, tid):
    r = ev(guarantor_age=age)
    x = [a for a in r["reasons"] if a["key"] == "guarantor_age"][0]
    assert x["kind"] == "return" and x["tid"] == tid
    assert r["status"] == STATUS_RETURNED


def test_guarantor_age_margin_accepted():
    assert "guarantor_age" not in keys(ev(guarantor_age=20.6))
    assert "guarantor_age" not in keys(ev(guarantor_age=62.4))


# ---------------------------------------------------------------- engine returns ids, never text
def test_reasons_have_no_message_text_only_template_ids():
    r = ev(is_nid_edited=True, guarantor_age=70, has_original_nid=False, office_phone_number=True)
    for x in r["reasons"]:
        assert set(x) == {"key", "kind", "tid", "params", "why"}
        assert "msg" not in x and "text" not in x


def test_every_engine_template_id_exists_with_the_right_kind():
    for k, tid in TID.items():
        assert tid in BUILTIN, k
    for flag, tid in FLAG_TID.items():
        assert BUILTIN[tid]["kind"] == "reject", flag
    for k in ("tx_month", "tx3_15k", "slip_hours", "slip_bad", "nid_name_c", "nid_name_g", "office_phone", "g_no_prof",
              "nid_orig", "g_not_family", "spouse_proof", "g_age_high", "g_age_low", "job_id", "lic_none", "lic_expired",
              "rider", "landowner", "stmt_not_3_months"):
        assert BUILTIN[TID[k]]["kind"] == "return", k
    for k in ("rel_reject", "not_served", "outside_area", "age_customer"):
        assert BUILTIN[TID[k]]["kind"] == "reject", k


@pytest.mark.parametrize("flag", REJECT_FLAGS)
def test_each_red_flag_rejects(flag):
    r = ev(**{flag: True})
    assert ("flag:" + flag) in keys(r, "reject")
    assert r["status"] == STATUS_REJECTED


def test_not_served_and_outside_area():
    r = ev(profession="lawyer", outside_address_area=True)
    assert {"not_served:customer", "outside_area"} <= set(keys(r, "reject"))
    x = [a for a in r["reasons"] if a["key"] == "not_served:customer"][0]
    assert x["params"] == {"who": "Customer", "category": "Lawyer"}


# ---------------------------------------------------------------- rules kept from the old engine
def test_clean_case_is_approved():
    r = ev()
    assert r["status"] == STATUS_APPROVED and r["reasons"] == []


def test_original_nid_and_nid_names_and_office_phone():
    r = ev(has_original_nid=False, nid_name_mismatch=True, guarantor_nid_name_mismatch=True, office_phone_number=True)
    assert {"nid_orig", "nid_name_c", "nid_name_g", "office_phone"} <= set(keys(r, "return"))


def test_unemployed_needs_guarantor_with_profession():
    r = ev(profession="unemployed", guarantor_profession="unemployed")
    assert "g_no_prof" in keys(r, "return")
    assert evaluate_application({**BASE, "profession": "unemployed", "guarantor_profession": "job_holder"})["status"] == STATUS_APPROVED


def test_name_mismatch_rules():
    assert ev(name_mismatch=True, guarantor_relation="mother")["status"] == STATUS_APPROVED
    assert "g_not_family" in keys(ev(name_mismatch=True, guarantor_relation="friend"), "return")
    assert "spouse_proof" in keys(ev(name_mismatch=True, guarantor_relation="spouse", spouse_proof="none"), "return")
    assert ev(name_mismatch=True, guarantor_relation="spouse", spouse_proof="marriage_certificate")["status"] == STATUS_APPROVED
    assert any(m[0] == "guarantor_relation" for m in find_missing({**BASE, "name_mismatch": True}))


def test_salary_slip_outside_hours_and_handwritten():
    r = ev(salary_slip_submitted=True, submission_note="evening", salary_slip_handwritten=True)
    assert {"slip_hours", "slip_bad"} <= set(keys(r, "return"))
    r = ev(salary_slip_submitted=True, submission_datetime="2026-11-13T11:00")   # a Friday
    assert "slip_hours" in keys(r)
    r = ev(salary_slip_submitted=True, submission_datetime="2026-11-15T11:00")   # a Sunday, 11 AM
    assert "slip_hours" not in keys(r)


def test_relationship_check():
    assert "relation_major" in keys(ev(relation_check="major"), "reject")
    r = ev(relation_check="pending")
    assert "relation_pending" in keys(r, "action") and r["status"] == "ACTION REQUIRED"
    assert ev(relation_check="corrected")["status"] == STATUS_APPROVED
    assert "side_prompting" in keys(ev(side_prompting=True), "action")


@pytest.mark.parametrize("prof,extra,key", [
    ("job_holder", {"tx_3_month": 10000, "job_id_status": "original"}, "tx3_15k"),
    ("job_holder", {"tx_3_month": 20000, "job_id_status": "none", "down_payment_pct": 10}, "job_id"),
    ("businessman", {"tx_3_month": 20000, "trade_license_status": "none", "down_payment_pct": 10}, "lic_none"),
    ("businessman", {"tx_3_month": 20000, "trade_license_status": "expired", "has_shop_photos": False}, "lic_expired"),
    ("rider", {"down_payment_pct": 20}, "rider"),
    ("house_owner", {"down_payment_pct": 10, "rental_income": 5000}, "landowner"),
])
def test_high_mrp_actions_carry_templates(prof, extra, key):
    r = evaluate_application({"customer_age": 30, "mrp": 60000, "tx_1_month": 5000, "profession": prof, **extra})
    x = [a for a in r["reasons"] if a["key"] == key]
    assert x and x[0]["kind"] == "action" and x[0]["tid"] == TID[key]
    assert r["status"] == "ACTION REQUIRED"


def test_high_mrp_exemptions():
    r = evaluate_application({"customer_age": 30, "mrp": 60000, "tx_1_month": 5000, "profession": "job_holder", "tx_3_month": 30000})
    assert r["status"] == STATUS_APPROVED


def test_internal_notes_exist_but_are_not_reasons():
    r = ev(repeat_customer=True, down_payment_pct=40)
    assert any("Repeat customer" in n for n in r["notes"]) and any("40%+" in n for n in r["notes"])
    assert all(x["tid"] is None or x["tid"] in BUILTIN for x in r["reasons"])


def test_missing_questions():
    r = evaluate_application({})
    assert {k for k, _ in r["missing"]} >= {"customer_age", "profession", "mrp", "tx_1_month"}
    assert r["status"] == STATUS_NEED_INFO
