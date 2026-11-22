"""
TopPay Services Ltd. - deterministic policy engine (effective 8 November).
Pure Python, no external dependencies. All thresholds live in CONFIG so the policy can be changed in one place.

The engine NEVER contains message text. Every reason is a dict
    {"key": stable rule key, "kind": "reject" | "return" | "action", "tid": template id or None,
     "params": {placeholder values}, "why": short internal explanation (English)}
and the text is looked up from the template store (templates_store.py: built-in -> global admin edit);
the browser may add a personal (local) edit on top. So a message can change without touching this file.

Final status is decided ONLY by combine_status() (automatic reasons + manual reasons + dismissals):
    REJECTED > RETURNED > MORE INFO NEEDED > ACTION REQUIRED > APPROVED
"""
from __future__ import annotations

from datetime import datetime

import policy

# ----------------------------------------------------------------- CONFIG
DEFAULT_CONFIG = {
    "customer_age": (19, 62),
    "guarantor_age": (21, 62),
    # SOP: in the last 3 months at least ONE month needs a cash-in OR a cash-out of 2,000+ (each direction on its own,
    # NOT cash-in + cash-out added together). 6,000+ in one month (same way) = fast-track guarantor call.
    "min_month_tx": 2000,
    "fast_track_tx": 6000,
    "high_mrp": 50000,
    "high_mrp_tx3": 15000,       # 3-month total (cash-in + cash-out added together) for MRP >= 50,000
    "tx3_exempt": 30000,
    "dp_exempt_pct": 40,
    "salary_exempt": 25000,
    "rental_income_min": 25000,
    # Business hours (24h) from the Issue Template: 9 AM - 5 PM. Bangladesh weekend = Fri, Sat.
    "business_hours": (9, 17),
    "weekend_days": (4, 5),  # Monday=0 ... Friday=4, Saturday=5
    # Fairness margins: age is judged in decimal years (26.6 = 26y 7m) with a 6-month margin either side;
    # money thresholds get a small BDT margin (not MRP - that is a price, 49,999 stays below 50,000).
    "age_tolerance_years": 0.5,
    "money_tolerance": 60,
    "statement_months": 3,
    # MRP below 50,000 with down payment >= 40%: guarantor call can be short (internal note only).
    "dp40_short_guarantor_call": True,
}

CONFIG = DEFAULT_CONFIG   # kept for old imports/tests; the engine itself reads C() = the live (admin-editable) policy


def C() -> dict:
    """Live policy (defaults + what the admin saved). See policy.py."""
    return policy.effective()


PROFESSIONS = ["job_holder", "student", "businessman", "rider", "house_owner", "unemployed", "other"]

NOT_SERVED = {
    "media_press": "Media / press worker",
    "ngo_loan": "Staff of a loan-providing NGO",
    "competitor": "Employee of another mobile installment / phone brand / competitor",
    "defense": "Defense-related person (military, police, etc.)",
    "lawyer": "Lawyer",
    "disabled": "Person with disability (blind, deaf, physical or intellectual)",
}

FIRST_BLOOD = {"father", "mother", "son", "daughter", "brother", "sister"}

STATUS_APPROVED = "APPROVED"
STATUS_ACTION = "ACTION REQUIRED"
STATUS_RETURNED = "RETURNED"
STATUS_REJECTED = "REJECTED / SUSPECTED FRAUD"
STATUS_NEED_INFO = "MORE INFO NEEDED"

# ----------------------------------------------- template ids (texts: templates_data.py + admin edits)
TID = {
    "tx_month": "stm.24",        # best month below 2,000 (cash-in OR cash-out) - wording changed Nov 2026 (not the sum)
    "tx3_15k": "job.02", "slip_hours": "stm.22", "slip_bad": "stm.23",
    "nid_name_c": "nid.09", "nid_name_g": "nid.10", "office_phone": "con.15", "g_no_prof": "gua.09",
    "nid_orig": "nid.02", "g_not_family": "gua.05", "spouse_proof": "stm.16",
    "g_age_high": "gua.02", "g_age_low": "gua.04", "job_id": "job.01",
    "lic_none": "biz.01", "lic_expired": "biz.03", "rider": "biz.06", "landowner": "biz.07",
    "stmt_not_3_months": "stm.01",
    "rel_reject": "rej.28", "not_served": "rej.29", "outside_area": "rej.30", "age_customer": "rej.31",
}

# red flag checkbox -> English reject template (order = display order; same names are checkboxes in public/index.html)
FLAG_TID = {
    "is_nid_edited": "rej.23", "nid_parent_names_edited": "rej.11", "nid_ai_fake": "rej.05",
    "nid_not_in_portal": "rej.09", "nid_photo_mismatch": "rej.15", "voice_mismatch": "rej.06",
    "customer_not_interested": "rej.16", "guarantor_nid_edited": "rej.24", "guarantor_nid_not_in_portal": "rej.13",
    "guarantor_nid_no_sign": "rej.17", "guarantor_nid_ears": "rej.19", "is_statement_edited": "rej.25",
    "palmpay_edited": "rej.14", "palmpay_overdue": "rej.26", "repeated_resubmit": "rej.18",
    "call_info_unverifiable": "rej.27",
}
REJECT_FLAGS = list(FLAG_TID)

# Every field the form / API may fill. None = not mentioned.
FIELDS = [
    "mrp", "customer_age", "guarantor_age", "profession", "guarantor_profession",
    "tx_1_month", "tx_3_month", "down_payment_pct", "monthly_salary", "rental_income",
    "has_original_nid", "name_mismatch", "nid_name_mismatch", "guarantor_nid_name_mismatch",
    "office_phone_number", "repeat_customer",
    "guarantor_relation", "spouse_proof", "relation_check", "side_prompting",
    "outside_address_area", "salary_slip_submitted", "salary_slip_handwritten",
    "submission_datetime", "submission_note", "job_id_status", "trade_license_status",
    "has_shop_photos", "statement_in_business_name",
    "stmt_months_covered",   # derived by the browser statement checker (0-3); no statement content is ever sent
] + REJECT_FLAGS


def _r(kind: str, key: str, why: str, tid: str | None = None, **params) -> dict:
    return {"key": key, "kind": kind, "tid": tid, "params": params, "why": why}


# ---------------------------------------------------------------- helpers
def _num(v):
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def _flag(v):
    """True only when explicitly True (unknown/None is treated as 'no problem')."""
    return v is True


def _ge(value, threshold):
    """value >= threshold, allowing the small money tolerance (e.g. 1,940 counts as 2,000)."""
    return value is not None and value >= threshold - C()["money_tolerance"]


def _fmt_age(a: float) -> str:
    y = int(a)
    m = int(round((a - y) * 12))
    if m == 12:
        y, m = y + 1, 0
    return f"{y}y {m}m"


def _best_month(d):
    """Best single month (the bigger of cash-in / cash-out) as typed or derived by the statement checker."""
    return _num(d.get("tx_1_month"))


def _exempt_known(d):
    """High-MRP exemptions we can already confirm (without asking for down payment)."""
    tx3 = _num(d.get("tx_3_month")) or 0
    sal = _num(d.get("monthly_salary")) or 0
    dp = _num(d.get("down_payment_pct")) or 0
    return (
        dp >= C()["dp_exempt_pct"]
        or _ge(tx3, C()["tx3_exempt"])
        or (d.get("profession") in ("job_holder", "student")
            and d.get("salary_slip_submitted") is True and _ge(sal, C()["salary_exempt"]))
    )


def _dp_relax(d) -> bool:
    """MRP < 50,000 and down payment >= 40%: no need to ask the guarantor many questions (internal)."""
    mrp, dp = _num(d.get("mrp")), _num(d.get("down_payment_pct"))
    return bool(C()["dp40_short_guarantor_call"] and mrp is not None and mrp < C()["high_mrp"]
                and dp is not None and dp >= C()["dp_exempt_pct"])


def _outside_hours(dt_str, note):
    """Return a reason string if salary slip was submitted outside working time."""
    if note in ("evening", "weekend", "holiday"):
        return f"submitted on {note}"
    if dt_str:
        try:
            dt = datetime.fromisoformat(str(dt_str).replace("Z", ""))
        except ValueError:
            return None
        start, end = C()["business_hours"]
        if dt.weekday() in C()["weekend_days"]:
            return "submitted on a weekend"
        if not (start <= dt.hour < end):
            return f"submitted outside business hours ({dt:%H:%M})"
    return None


# ---------------------------------------------------------- missing fields
def find_missing(d: dict) -> list[tuple[str, str]]:
    """Ask only for facts that the decision actually depends on."""
    q: list[tuple[str, str]] = []
    mrp = _num(d.get("mrp"))
    prof = d.get("profession")
    tx3 = _num(d.get("tx_3_month"))
    best = _best_month(d)

    if _num(d.get("customer_age")) is None:
        q.append(("customer_age", "Customer-er boyos koto?"))
    if prof is None:
        q.append(("profession", "Customer-er peshha ki? (job holder / student / businessman / rider / house owner / beker / onno)"))
    if mrp is None:
        q.append(("mrp", "MRP koto taka?"))
    if prof == "unemployed" and d.get("guarantor_profession") is None:
        q.append(("guarantor_profession", "Customer beker - guarantor-er peshha ki? (peshha thakte hobe)"))
    is_high_mrp = mrp is not None and mrp >= C()["high_mrp"]
    if best is None and not is_high_mrp:
        q.append(("tx_1_month", "Shobcheye bhalo 1 mash-er bKash/Nagad/bank transaction koto? (Debit + Credit / cash-in + cash-out miliye)"))
    if d.get("name_mismatch") is True and d.get("guarantor_relation") is None:
        q.append(("guarantor_relation", "Name mismatch ache - guarantor customer-er ke hoy? (father/mother/brother/sister/spouse/onno)"))
    if d.get("guarantor_relation") == "spouse" and d.get("name_mismatch") is True and d.get("spouse_proof") is None:
        q.append(("spouse_proof", "Spouse-er jonno marriage certificate ba child-er NID/QR birth certificate ache?"))

    if mrp is not None and mrp >= C()["high_mrp"] and prof:
        dp = _num(d.get("down_payment_pct"))
        if prof in ("job_holder", "student", "businessman") and tx3 is None:
            q.append(("tx_3_month", f"MRP {C()['high_mrp']:,}+; 3 mash-er total transaction (cash-in + cash-out jog kore) koto?"))
        if prof in ("rider", "house_owner") and dp is None:
            if not (prof == "house_owner" and _ge(_num(d.get("rental_income")) or 0, C()["rental_income_min"])):
                q.append(("down_payment_pct", "Down payment koto %?"))
        if prof == "house_owner" and _num(d.get("rental_income")) is None and dp is None:
            q.append(("rental_income", "Mashik rental income koto?"))
        if prof in ("job_holder", "student") and not _exempt_known(d):
            if d.get("job_id_status") is None:
                q.append(("job_id_status", "Original Job ID card (hard copy) ache? (original / photocopy / none / work_photo / visiting_card)"))
            if dp is None and d.get("job_id_status") in (None, "photocopy"):
                q.append(("down_payment_pct", "Down payment koto %?"))
        if prof == "businessman" and not _exempt_known(d):
            lic = d.get("trade_license_status")
            if lic is None:
                q.append(("trade_license_status", "Trade license-er obostha? (valid / expired / none)"))
            if lic == "expired" and d.get("has_shop_photos") is None:
                q.append(("has_shop_photos", "Signboard shoho 2-ta shop photo + cash counter-e owner-er photo ache?"))
            if lic in (None, "none") and dp is None:
                q.append(("down_payment_pct", "Down payment koto %?"))
    seen, out = set(), []
    for k, v in q:
        if k not in seen:
            seen.add(k)
            out.append((k, v))
    return out


# ------------------------------------------------------------- main engine
def evaluate_application(data: dict) -> dict:
    """Automatic part of the decision. Returns reasons (ids + params), passed checks, internal notes, missing facts.
    The final status is `combine_status(result["reasons"], manual, dismissed, result["missing"])`;
    result["status"] is that function with no manual reasons and no dismissals."""
    d = {k: data.get(k) for k in FIELDS}
    reasons: list[dict] = []
    ok, notes = [], []
    fast_track = False

    prof = d["profession"]
    gprof = d["guarantor_profession"]
    mrp = _num(d["mrp"])
    tx3 = _num(d["tx_3_month"])
    dp = _num(d["down_payment_pct"])
    cage = _num(d["customer_age"])
    gage = _num(d["guarantor_age"])
    R = reasons.append

    # ---- 1. FRAUD / REJECT (English reject reasons)
    for field in REJECT_FLAGS:
        if _flag(d[field]):
            R(_r("reject", "flag:" + field, f"Red-flag checkbox ticked: {field}", FLAG_TID[field]))
    for who, p in (("Customer", prof), ("Guarantor", gprof)):
        if p in NOT_SERVED and p in C()["not_served_on"]:
            R(_r("reject", f"not_served:{who.lower()}", f"{who} is in a NOT SERVED category: {NOT_SERVED[p]}",
                 TID["not_served"], who=who, category=NOT_SERVED[p]))
    if _flag(d["outside_address_area"]):
        R(_r("reject", "outside_area", "Applicant is outside the served address area", TID["outside_area"]))

    tol = C()["age_tolerance_years"]
    lo, hi = C()["customer_age"]
    if cage is not None:
        if lo <= cage <= hi:
            ok.append(f"Customer age {_fmt_age(cage)} is within {lo}-{hi}.")
        elif lo - tol <= cage <= hi + tol:
            ok.append(f"Customer age {_fmt_age(cage)} accepted (within the {tol * 12:.0f}-month margin of {lo}-{hi}).")
            notes.append(f"Customer age {_fmt_age(cage)} is outside {lo}-{hi} by less than {tol * 12:.0f} months - accepted.")
        else:
            R(_r("reject", "customer_age", f"Customer age {_fmt_age(cage)} is outside {lo}-{hi}.",
                 TID["age_customer"], age=_fmt_age(cage), range=f"{lo}-{hi}"))

    # ---- 1b. Guarantor age -> RETURN: BP must change the guarantor
    lo, hi = C()["guarantor_age"]
    if gage is not None:
        if lo <= gage <= hi:
            ok.append(f"Guarantor age {_fmt_age(gage)} is within {lo}-{hi}.")
        elif lo - tol <= gage <= hi + tol:
            ok.append(f"Guarantor age {_fmt_age(gage)} accepted (within the {tol * 12:.0f}-month margin of {lo}-{hi}).")
            notes.append(f"Guarantor age {_fmt_age(gage)} is outside {lo}-{hi} by less than {tol * 12:.0f} months - accepted.")
        elif gage > hi:
            R(_r("return", "guarantor_age", f"Guarantor age {_fmt_age(gage)} is above {hi} - guarantor must be changed.", TID["g_age_high"]))
        else:
            R(_r("return", "guarantor_age", f"Guarantor age {_fmt_age(gage)} is below {lo} - guarantor must be changed.", TID["g_age_low"]))

    # ---- 1c. Statement: 3 months covered, one month with cash-in OR cash-out >= 2,000
    months = _num(d["stmt_months_covered"])
    need_m = C()["statement_months"]
    if months is not None:
        if months < need_m:
            R(_r("return", "stmt_not_3_months", f"The statement covers only {months:.0f} of the last {need_m} months.",
                 TID["stmt_not_3_months"]))
        else:
            ok.append(f"The statement covers the last {need_m} months.")
    best = _best_month(d)
    is_high_mrp = mrp is not None and mrp >= C()["high_mrp"]
    if best is not None:
        if not is_high_mrp:
            if _ge(best, C()["min_month_tx"]):
                ok.append(f"At least one month has combined Debit + Credit (cash-in + cash-out) of BDT {C()['min_month_tx']:,} or more (best month {best:,.0f}).")
            else:
                R(_r("return", "tx_month",
                     f"No month reaches BDT {C()['min_month_tx']:,} in combined cash-in + cash-out (best month {best:,.0f}); "
                     f"the last {C()['exclude_last_days']} days before the application are not counted. Ask for another statement.",
                     TID["tx_month"]))
        if _ge(best, C()["fast_track_tx"]):
            fast_track = True
    if d.get("name_mismatch") is False and (best is not None or _num(d.get("tx_3_month")) is not None):
        notes.insert(0, "Customer Statement verified: Guarantor-কে শুধু Missed Call দিলেই হবে (missed call to guarantor is enough).")
    notes.append(f"Statement must cover the last {C()['statement_months']} months; the last {C()['exclude_last_days']} days before application "
                 f"are not counted. Cash-in + Cash-out (Debit + Credit) combined is counted for the {C()['min_month_tx']:,} / {C()['fast_track_tx']:,} / 15k / 30k rules.")

    # ---- 1d. Relationship check during the call (nervous slips get one chance; no prompting)
    rc = d["relation_check"]
    prompting = _flag(d["side_prompting"])
    if rc == "major":
        R(_r("reject", "relation_major", "Customer and guarantor gave inconsistent relationship information.", TID["rel_reject"]))
    elif rc == "pending" and not prompting:
        R(_r("action", "relation_pending",
             "Relationship answer is slightly different (e.g. chachato vs fufato bhai). The customer may be nervous - give ONE "
             "chance to correct it, without hinting the answer. If corrected: accepted. If still different: reject."))
    elif rc == "corrected" and not prompting:
        ok.append("Small relationship slip was corrected by the customer himself - accepted.")
    if prompting:
        extra = (" The correction came while someone was prompting, so it does not count - ask again."
                 if rc == "corrected" else "")
        R(_r("action", "side_prompting",
             "Someone nearby is telling the answers. Tell them to stop. Do not accept answers the customer repeats after "
             "hearing them - ask again so the customer answers on his own." + extra))

    # ---- 1e. Notes when a money threshold was met only thanks to the small BDT margin
    mt = C()["money_tolerance"]
    pairs = [("Best month (cash-in or cash-out)", best, C()["min_month_tx"]),
             ("Best month (Fast-Track)", best, C()["fast_track_tx"])]
    if mrp is not None and mrp >= C()["high_mrp"]:
        if prof in ("job_holder", "student", "businessman"):
            pairs += [("3-month transaction", tx3, C()["high_mrp_tx3"]),
                      ("3-month transaction (exemption)", tx3, C()["tx3_exempt"])]
        if prof in ("job_holder", "student"):
            pairs.append(("Monthly salary", _num(d["monthly_salary"]), C()["salary_exempt"]))
        if prof == "house_owner":
            pairs.append(("Rental income", _num(d["rental_income"]), C()["rental_income_min"]))
    for label, v, thr in pairs:
        if v is not None and thr - mt <= v < thr:
            notes.append(f"{label} {v:,.0f} is BDT {thr - v:,.0f} short of {thr:,} - accepted (margin: BDT {mt}).")

    if d["has_original_nid"] is False:
        R(_r("return", "nid_orig", "Customer must provide the ORIGINAL NID (photocopy not accepted for customer).", TID["nid_orig"]))

    # ---- 1f. Name vs NID, office phone, unemployed customer -> RETURN
    if _flag(d["nid_name_mismatch"]):
        R(_r("return", "nid_name_c", "Customer name does not match the NID.", TID["nid_name_c"]))
    if _flag(d["guarantor_nid_name_mismatch"]):
        R(_r("return", "nid_name_g", "Guarantor name does not match the NID.", TID["nid_name_g"]))
    if _flag(d["office_phone_number"]):
        R(_r("return", "office_phone", "An official/office phone number was given - a personal mobile number is required.",
             TID["office_phone"]))
    if prof == "unemployed":
        if gprof == "unemployed":
            R(_r("return", "g_no_prof", "Customer is unemployed, so the guarantor must have a profession - guarantor has none.",
                 TID["g_no_prof"]))
        elif gprof:
            ok.append("Customer is unemployed, but the guarantor has a profession.")
    if _dp_relax(d):
        notes.append(f"{C()['dp_exempt_pct']}%+ down payment on MRP below {C()['high_mrp']:,}: no need to ask the guarantor many questions on the call - "
                     "keep it short (phone reachable, knows the customer). All document checks stay the same.")
    if _flag(d["repeat_customer"]):
        notes.append("Repeat customer: do not ask many questions on the call - do a short verification and finish.")

    # ---- 2. RETURN (salary slip)
    if _flag(d["salary_slip_submitted"]):
        why = _outside_hours(d["submission_datetime"], d["submission_note"])
        if why:
            R(_r("return", "slip_hours", f"Salary slip {why} - cannot be verified (business hours: {C()['business_hours'][0]}:00 - {C()['business_hours'][1]}:00, working days).",
                 TID["slip_hours"]))
        if _flag(d["salary_slip_handwritten"]):
            R(_r("return", "slip_bad", "Salary slip has a handwritten signature/seal - an official company seal is required.",
                 TID["slip_bad"]))

    # ---- 3. NAME MISMATCH
    if _flag(d["name_mismatch"]):
        rel = d["guarantor_relation"]
        if rel in C()["first_blood"]:
            ok.append(f"Name mismatch is acceptable: guarantor is first-blood relative ({rel}).")
        elif rel == "spouse":
            if d["spouse_proof"] in ("marriage_certificate", "child_nid", "qr_birth_certificate"):
                ok.append("Name mismatch is acceptable: spouse with valid proof.")
            else:
                R(_r("return", "spouse_proof", "Spouse statement needs a marriage certificate OR the children's NID / QR birth certificate.",
                     TID["spouse_proof"]))
        elif rel is not None:
            R(_r("return", "g_not_family", "Name mismatch: guarantor must be a first-blood relative or a spouse with proof. Change the guarantor.",
                 TID["g_not_family"]))
    elif d["guarantor_relation"] == "spouse" and d["spouse_proof"] == "none":
        R(_r("return", "spouse_proof", "Wife-এর NID-তে স্বামীর নাম না থাকলে Marriage Certificate অথবা সন্তানের NID / Birth Certificate দিতে হবে।", TID["spouse_proof"]))

    # ---- 4. HIGH-MRP RULES
    if mrp is not None:
        if mrp < C()["high_mrp"]:
            ok.append(f"MRP below {C()['high_mrp']:,} - basic requirements apply.")
            if _flag(d["statement_in_business_name"]) and d["trade_license_status"] != "valid":
                R(_r("action", "lic_business_stmt", "Statement is in a business name - a VALID trade license is required.", TID["lic_none"]))
        else:
            _high_mrp(d, prof, tx3, dp, ok, reasons, notes)

    missing = find_missing(d)
    out = {
        "reasons": reasons,
        "passed": ok,
        "notes": notes,
        "missing": missing,
        "fast_track": fast_track,
        "fast_track_msg": "Fast-Track Guarantor Check: ask only 2 questions - (1) Is the guarantor's phone reachable? "
                          "(2) Does the guarantor know the customer?" if fast_track else "",
    }
    out["status"] = combine_status(reasons, [], [], missing)["status"]
    return out


def _high_mrp(d, prof, tx3, dp, ok, reasons, notes):
    CFG = C()
    sug = f"Otherwise reduce MRP below {CFG['high_mrp']:,}."
    dp_ok = dp is not None and dp >= CFG["dp_exempt_pct"]
    R = reasons.append

    if prof in ("job_holder", "student"):
        if tx3 is not None:
            if _ge(tx3, CFG["high_mrp_tx3"]):
                ok.append(f"3-month transaction {tx3:,.0f} >= {CFG['high_mrp_tx3']:,}.")
            else:
                R(_r("action", "tx3_15k", f"3-month transaction {tx3:,.0f} is below {CFG['high_mrp_tx3']:,}. Reduce MRP below {CFG['high_mrp']:,}.", TID["tx3_15k"]))
        jid = d["job_id_status"]
        if _exempt_known(d):
            ok.append(f"Job ID not required (down payment >= {CFG['dp_exempt_pct']}% / 3-month tx >= {CFG['tx3_exempt']:,} / valid salary slip > {CFG['salary_exempt']:,}).")
        elif jid == "original":
            ok.append("Original Job ID card (hard copy) provided.")
        elif jid in ("work_photo", "visiting_card"):
            ok.append("No ID card, but work photo / visiting card accepted.")
        elif jid in ("photocopy", "none") or jid is not None:
            R(_r("action", "job_id", "Original Job ID card (hard copy) required - scan/photocopy not accepted. "
                 "No ID? Work photo or visiting card is accepted. " + sug, TID["job_id"]))
    elif prof == "businessman":
        if tx3 is not None:
            if _ge(tx3, CFG["high_mrp_tx3"]):
                ok.append(f"3-month transaction {tx3:,.0f} >= {CFG['high_mrp_tx3']:,}.")
            else:
                R(_r("action", "tx3_15k", f"3-month transaction {tx3:,.0f} is below {CFG['high_mrp_tx3']:,}. Reduce MRP below {CFG['high_mrp']:,}.", TID["tx3_15k"]))
        lic = d["trade_license_status"]
        if _exempt_known(d) and lic != "valid":
            ok.append(f"Trade license not required (down payment >= {CFG['dp_exempt_pct']}% or 3-month tx >= {CFG['tx3_exempt']:,}).")
        elif lic == "valid":
            ok.append("Valid trade license provided.")
        elif lic == "expired":
            if d["has_shop_photos"] is True:
                ok.append("License expired, but 2 shop photos (signboard + owner at cash counter) provided.")
            elif d["has_shop_photos"] is False:
                R(_r("action", "lic_expired", "License expired: take at least 2 shop photos with signboard and the owner at the cash counter.",
                     TID["lic_expired"]))
        elif lic in ("none",):
            R(_r("action", "lic_none", f"Valid trade license required (or down payment >= {CFG['dp_exempt_pct']}%, or 3-month tx >= {CFG['tx3_exempt']:,}). " + sug, TID["lic_none"]))
    elif prof == "rider":
        if dp_ok:
            ok.append(f"Rider: down payment >= {CFG['dp_exempt_pct']}%.")
        elif dp is not None:
            R(_r("action", "rider", f"Rider needs {CFG['dp_exempt_pct']}%+ down payment (got {dp:.0f}%). Otherwise eligible for MRP below {CFG['high_mrp']:,} only.", TID["rider"]))
    elif prof == "house_owner":
        rent = _num(d["rental_income"])
        if _ge(rent, CFG["rental_income_min"]):
            ok.append(f"House owner: rental income {rent:,.0f} >= {CFG['rental_income_min']:,} - may apply for MRP >= {CFG['high_mrp']:,} (proof required).")
        elif dp_ok:
            ok.append(f"House owner: down payment >= {CFG['dp_exempt_pct']}%.")
        elif dp is not None or rent is not None:
            R(_r("action", "landowner", f"House owner needs rental-income proof >= {CFG['rental_income_min']:,}/month OR {CFG['dp_exempt_pct']}%+ down payment. " + sug, TID["landowner"]))
    else:
        R(_r("action", "prof_no_match", f"Profession does not match any MRP >= {CFG['high_mrp']:,} category. Reduce MRP below {CFG['high_mrp']:,}."))


# ------------------------------------------------------------- status combination
def combine_status(auto: list[dict], manual: list[dict] | None = None, dismissed=None, missing=None) -> dict:
    """The ONE place where the final status is decided.

    auto      reasons from evaluate_application (each has key, kind)
    manual    reasons the reviewer added by hand: dicts with at least {"kind": "reject" | "return"}
    dismissed set/list of automatic reason keys the reviewer switched off (they stay visible, but do not count)
    missing   list of facts still needed (from find_missing)

    Order:  REJECTED > RETURNED > MORE INFO NEEDED > ACTION REQUIRED > APPROVED
      * any ACTIVE reject (automatic, not dismissed, or manual)  -> REJECTED
      * any ACTIVE return (automatic, not dismissed, or manual)  -> at least RETURNED
      * else missing facts                                       -> MORE INFO NEEDED
      * else any active automatic action                         -> ACTION REQUIRED
      * else                                                     -> APPROVED
    """
    dismissed = set(dismissed or [])
    manual = manual or []
    active_auto = [r for r in auto if r["key"] not in dismissed]
    kinds = [r["kind"] for r in active_auto] + [m.get("kind") for m in manual]
    if "reject" in kinds:
        status = STATUS_REJECTED
    elif "return" in kinds:
        status = STATUS_RETURNED
    elif missing:
        status = STATUS_NEED_INFO
    elif "action" in kinds:
        status = STATUS_ACTION
    else:
        status = STATUS_APPROVED
    return {
        "status": status,
        "active": {k: kinds.count(k) for k in ("reject", "return", "action")},
        "dismissed": sorted(k for k in dismissed if any(r["key"] == k for r in auto)),
    }
