import re
import unicodedata
from datetime import datetime, timezone, timedelta

import pytest

import templates_store as ts
from conftest import login
from templates_data import BUILTIN, TEMPLATES


# ---------------------------------------------------------------- built-in library
def test_ids_are_unique_and_follow_the_pattern():
    ids = [it["id"] for s in TEMPLATES["sections"] for it in s["items"]]
    assert len(ids) == len(set(ids)) >= 130
    assert all(re.fullmatch(r"[a-z]{2,3}\.\d{2}", i) for i in ids)


def test_reject_templates_are_english_and_no_html_anywhere():
    for t in BUILTIN.values():
        assert "<" not in t["text"] and ">" not in t["text"]
        if t["kind"] == "reject":
            assert not re.search(r"[ঀ-৿]", t["text"]), t["id"]


def test_new_items_from_the_dump_are_marked_for_review():
    new = [t for t in BUILTIN.values() if t.get("new")]
    assert len(new) >= 15 and all(t["source"] == "dump" for t in new)


def test_changed_rule_wording_is_marked_and_not_the_sum():
    t = BUILTIN["stm.24"]
    nfd = lambda s: unicodedata.normalize("NFD", s)
    assert t.get("changed") and nfd("আলাদাভাবে") in nfd(t["text"]) and nfd("মিলিয়ে") not in nfd(t["text"].split("।")[0])
    assert nfd("মিলিয়ে") in nfd(BUILTIN["stm.04"]["text"])        # the official old wording stays as it was


# ---------------------------------------------------------------- placeholders
def test_month_context_dhaka_november_and_wrap_around():
    c = ts.tpl_context(datetime(2026, 11, 15, tzinfo=timezone(timedelta(hours=6))))
    assert c["m3"] == "August, September, October" and c["m3_bn"] == "আগস্ট, সেপ্টেম্বর, অক্টোবর" and c["m1_bn"] == "আগস্ট"
    c = ts.tpl_context(datetime(2027, 1, 2, tzinfo=timezone(timedelta(hours=6))))
    assert c["m3"] == "October, November, December"
    c = ts.tpl_context(datetime(2027, 2, 2, tzinfo=timezone(timedelta(hours=6))))
    assert c["m3"] == "November, December, January"


def test_render_fills_known_and_keeps_unknown():
    assert ts.render("A {m3} B {holder}", {}, {"m3": "X"}) == "A X B {holder}"
    assert ts.render("{who} {category}", {"who": "Customer", "category": "Lawyer"}) == "Customer Lawyer"
    assert ts.placeholders("{m3} {holder} {m3}") == ["m3", "holder"]


# ---------------------------------------------------------------- validation
@pytest.mark.parametrize("text", ["", "   ", "x" * 2001, "hi <b>x</b>", "a > b", "bad \x07 char"])
def test_validation_rejects_bad_text(text):
    with pytest.raises(ts.TemplateError):
        ts.validate_text(text, "return")


def test_reject_reason_must_stay_english():
    with pytest.raises(ts.TemplateError):
        ts.validate_text("Rejected কারণ fake", "reject")
    assert ts.validate_text("  Rejected due to fake statement.  ", "reject") == "Rejected due to fake statement."
    assert ts.validate_text("বাংলা চলবে", "return") == "বাংলা চলবে"


# ---------------------------------------------------------------- global layer through the API
def tpl(client, headers, tid):
    items = [i for s in client.get("/api/templates", headers=headers).json()["sections"] for i in s["items"]]
    return next((i for i in items if i["id"] == tid), None)


def test_admin_edit_is_visible_to_users_with_date_and_author(client, admin, user):
    r = client.put("/api/templates/nid.09", json={"text": "NID অনুযায়ী নাম ঠিক করুন।"}, headers=admin)
    assert r.status_code == 200
    got = tpl(client, user, "nid.09")
    assert got["text"] == "NID অনুযায়ী নাম ঠিক করুন।" and got["overridden"] and got["edited_by"] == "boss" and got["edited_at"]
    assert got["builtin_text"].startswith("NID অনুযায়ী কাস্টমারের নাম")


def test_edit_changes_the_engine_message_too(client, admin, user):
    client.put("/api/templates/nid.09", json={"text": "NEW WORDING {m3}"}, headers=admin)
    out = client.post("/api/check", json={"data": {"nid_name_mismatch": True}}, headers=user).json()
    x = next(r for r in out["reasons"] if r["id"] == "nid_name_c")
    assert x["text"].startswith("NEW WORDING August") or x["text"].startswith("NEW WORDING ")
    assert x["template"] == "NEW WORDING {m3}" and x["tid"] == "nid.09"


def test_reset_to_builtin(client, admin, user):
    client.put("/api/templates/nid.09", json={"text": "changed"}, headers=admin)
    assert client.post("/api/templates/nid.09/reset", headers=admin).status_code == 200
    got = tpl(client, user, "nid.09")
    assert not got["overridden"] and got["text"] == got["builtin_text"]


def test_saving_the_builtin_text_again_clears_the_override(client, admin, user):
    t = tpl(client, admin, "nid.09")["builtin_text"]
    client.put("/api/templates/nid.09", json={"text": "x"}, headers=admin)
    client.put("/api/templates/nid.09", json={"text": t}, headers=admin)
    assert not tpl(client, user, "nid.09")["overridden"]


def test_custom_template_create_edit_delete(client, admin, user):
    r = client.post("/api/templates", json={"section": "nid", "text": "নতুন মেসেজ"}, headers=admin)
    tid = r.json()["id"]
    assert tid.startswith("cus.")
    got = tpl(client, user, tid)
    assert got["custom"] and got["text"] == "নতুন মেসেজ"
    assert client.put(f"/api/templates/{tid}", json={"text": "বদলানো"}, headers=admin).status_code == 200
    assert tpl(client, user, tid)["text"] == "বদলানো"
    assert client.delete(f"/api/templates/{tid}", headers=admin).status_code == 200
    assert tpl(client, user, tid) is None


def test_custom_reject_must_be_english_and_section_must_exist(client, admin):
    assert client.post("/api/templates", json={"section": "reject", "text": "বাংলা"}, headers=admin).status_code == 400
    assert client.post("/api/templates", json={"section": "nope", "text": "x"}, headers=admin).status_code == 400
    assert client.post("/api/templates", json={"section": "reject", "text": "Rejected: custom reason."}, headers=admin).status_code == 200


def test_builtin_cannot_be_deleted_only_hidden(client, admin, user):
    assert client.delete("/api/templates/nid.01", headers=admin).status_code == 400
    assert client.post("/api/templates/nid.01/hidden", json={"hidden": True}, headers=admin).status_code == 200
    assert tpl(client, user, "nid.01") is None                       # users do not see it
    assert tpl(client, admin, "nid.01")["hidden"] is True            # admin still sees it (to un-hide)
    client.post("/api/templates/nid.01/hidden", json={"hidden": False}, headers=admin)
    assert tpl(client, user, "nid.01") is not None


def test_templates_the_engine_needs_cannot_be_hidden(client, admin):
    r = client.post("/api/templates/nid.09/hidden", json={"hidden": True}, headers=admin)
    assert r.status_code == 400 and "rule engine" in r.json()["detail"]


def test_html_and_long_text_rejected_by_api(client, admin):
    assert client.put("/api/templates/nid.01", json={"text": "<script>alert(1)</script>"}, headers=admin).status_code == 400
    assert client.put("/api/templates/nid.01", json={"text": "x" * 2001}, headers=admin).status_code == 400
    assert client.put("/api/templates/rej.01", json={"text": "বাংলা reject"}, headers=admin).status_code == 400
    assert client.put("/api/templates/zzz.99", json={"text": "x"}, headers=admin).status_code == 400


def test_user_cannot_write_global_templates(client, user):
    assert client.put("/api/templates/nid.01", json={"text": "hacked"}, headers=user).status_code == 403
    assert client.post("/api/templates", json={"section": "nid", "text": "x"}, headers=user).status_code == 403
    assert client.post("/api/templates/nid.01/hidden", json={"hidden": True}, headers=user).status_code == 403
    assert client.post("/api/templates/nid.01/reset", headers=user).status_code == 403
    assert client.delete("/api/templates/nid.01", headers=user).status_code == 403
    assert tpl(client, user, "nid.01")["text"] == tpl(client, user, "nid.01")["builtin_text"]


def test_writes_are_rate_limited(client, admin):
    codes = [client.put("/api/templates/nid.01", json={"text": f"v{i}"}, headers=admin).status_code for i in range(45)]
    assert codes[:40] == [200] * 40 and set(codes[40:]) == {429}


def test_all_template_endpoints_need_login(client):
    assert client.get("/api/templates").status_code == 401
    assert client.put("/api/templates/nid.01", json={"text": "x"}).status_code == 401
