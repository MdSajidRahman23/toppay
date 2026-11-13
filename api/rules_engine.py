"""
TopPay Services Ltd. - deterministic policy engine (effective 8 November).
Pure Python, no external dependencies. All thresholds live in CONFIG so the
policy can be changed in one place.

Every reason in the result is a dict: {"text": short explanation, "msg": ready-to-send message}.
 - returns / actions: msg = the official Bangla BP message from the Issue Template
 - rejects:           msg = the official English reject reason from the Issue Template
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# ----------------------------------------------------------------- CONFIG
CONFIG = {
    "customer_age": (19, 62),
    "guarantor_age": (21, 62),
    "min_month_tx": 2000,
    "fast_track_tx": 6000,
    "high_mrp": 50000,
    "high_mrp_tx3": 15000,
    "tx3_exempt": 30000,
    "dp_exempt_pct": 40,
    "salary_exempt": 25000,
    "rental_income_min": 25000,
    # Business hours (24h) from the Issue Template: 9 AM - 5 PM. Bangladesh weekend = Fri, Sat.
    "business_hours": (9, 17),
    "weekend_days": (4, 5),  # Monday=0 ... Friday=4, Saturday=5
    # Fairness margins: age is judged in decimal years (26.6 = 26y 7m) with a 6-month margin
    # either side; money thresholds get a small BDT margin (not MRP - that is a price, 49,999 stays below 50,000).
    "age_tolerance_years": 0.5,
    "money_tolerance": 100,
}

PROFESSIONS = ["job_holder", "student", "businessman", "rider", "house_owner", "other"]

NOT_SERVED = {
    "media_press": "Media / press worker",
    "ngo_loan": "Staff of a loan-providing NGO",
    "competitor": "Employee of another mobile installment / phone brand / competitor",
    "defense": "Defense-related person (military, police, etc.)",
    "lawyer": "Lawyer",
    "disabled": "Person with disability (blind, deaf, physical or intellectual)",
}

FIRST_BLOOD = {"father", "mother", "brother", "sister"}

STATUS_APPROVED = "APPROVED"
STATUS_ACTION = "ACTION REQUIRED"
STATUS_RETURNED = "RETURNED"
STATUS_REJECTED = "REJECTED / SUSPECTED FRAUD"
STATUS_NEED_INFO = "MORE INFO NEEDED"

# ------------------------------------------- red flags -> official reject text
# (field, reject reason as written in the Issue Template). Order = display order.
# The same field names must exist as checkboxes in public/index.html.
REJECT_FLAGS = [
    ("is_nid_edited", "Customer is suspected of fraud. The customer's NID card was edited."),
    ("nid_parent_names_edited", "Customer is suspected of fraud. The customer's NID card was edited by changing the parents' names."),
    ("nid_ai_fake", "The customer's NID card has been identified as fake and AI-generated."),
    ("nid_not_in_portal", "Customer is suspected of fraud. No record of the customer's NID was found in the e-Passport verification portal."),
    ("nid_photo_mismatch", "Customer is suspected of fraud. The customer's NID photo does not match the on-site photos."),
    ("voice_mismatch", "Customer is suspected of fraud. Someone else has spoken as a customer."),
    ("customer_not_interested", "As per the customer voice, the customer does not want to buy this phone anymore."),
    ("guarantor_nid_edited", "Guarantor is suspected of fraud. The guarantor's NID card was edited."),
    ("guarantor_nid_not_in_portal", "Guarantor is suspected of fraud. The guarantor's NID is fake. No record of the NID was found on the e-Passport verification portal."),
    ("guarantor_nid_no_sign", "Suspected fraud. Guarantor NID card is fake (here guarantor sign / fingerprint doesn't exist). That's why this application is rejected."),
    ("guarantor_nid_ears", "The guarantor's ears are not visible in the NID card photo. Normally, the ears should be visible in an NID card photo. This indicates that the NID card has been edited."),
    ("is_statement_edited", "Rejected due to fake bKash/Nagad statement. The statement has been edited."),
    ("palmpay_edited", "Customer is suspected of fraud. The customer's PalmPay records have been edited."),
    ("palmpay_overdue", "The customer has an overdue loan on PalmPay."),
    ("repeated_resubmit", "The required documents were requested multiple times and explained over the phone, but the BP kept resubmitting without providing them. Therefore, the application has been rejected."),
    ("call_info_unverifiable", "Call information is incorrect or unverifiable - rejected for suspected fraud."),
    ("office_phone_number", "Official/office phone number given - a personal mobile number is required."),
]

# Every field the form / API may fill. None = not mentioned.
FIELDS = [
    "mrp", "customer_age", "guarantor_age", "profession", "guarantor_profession",
    "tx_1_month", "tx_3_month", "down_payment_pct", "monthly_salary", "rental_income",
    "has_original_nid", "name_mismatch",
    "guarantor_relation", "spouse_proof", "relation_check", "side_prompting",
    "outside_address_area", "salary_slip_submitted", "salary_slip_handwritten",
    "submission_datetime", "submission_note", "job_id_status", "trade_license_status",
    "has_shop_photos", "statement_in_business_name",
] + [f for f, _ in REJECT_FLAGS]

# ------------------------------------------ official Bangla BP messages (returns)
T_TX_MONTH = ("গত ৩ মাসের ({m3}) স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি (আবেদন এর দিন থেকে গত ৭ দিন বাদ এ "
              "(যে কোন এক মাসে ক্যাশ ইন অথবা ক্যাশ আউট মিলিয়ে ২০০০ টাকা)। অনুগ্রহ করে গ্রাহকের অন্য স্টেটমেন্ট "
              "বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই স্টেটমেন্ট সাবমিট করুন।")
T_TX3_15K = ("গত ৩ মাসের স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি (ক্যাশ ইন অথবা ক্যাশ আউট মিলিয়ে ১৫,০০০টাকা, "
             "অনুগ্রহ করে গ্রাহকের অন্য স্টেটমেন্ট বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই "
             "স্টেটমেন্ট সাবমিট করুন।")
T_SLIP_HOURS = ("কাস্টমার স্যালারি স্লিপ দিয়েছেন এবং Business hour এর পরে আবেদন করেছেন। অনুগ্রহ করে আবেদন টি "
                "business hour (সকাল ৯ টা থেকে বিকেল ৫ টা) এর মধ্যে করার জন্য অনুরোধ করা হলো।")
T_SLIP_BAD = ("কাস্টমার যে স্যালারি স্লিপ দিয়েছেন সেখানে কোম্পানি থেকে দেওয়া কোম্পানি এর পরিচিতি, স্যালারি স্লিপ যাচাই "
              "এর জন্য যোগাযোগের মাধ্যম, সিল এবং ওই ডিপার্টমেন্ট প্রধানের নাম পদবি সহ সাক্ষর থাকা লাগবে। যেটা এই "
              "স্যালারি স্লিপ এ নেই। তাই অনুগ্রহ করে কাস্টমার এর গত ৩ মাসের ({m3}) PDF বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট "
              "প্রদান করুন।")
T_NID_ORIG = "কাস্টমারের Original NID-এর উভয় পাশের ছবি জমা দিন; ফটোকপি/স্ক্যান কপি NID গ্রহণযোগ্য নয়।"
T_G_NOT_FAMILY = ("জামিনদার রক্তের সম্পর্কযুক্ত বা স্বামী/স্ত্রী নন। অনুগ্রহ করে জামিনদার পরিবর্তন করুন "
                  "(শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১--৬২ বছর)।")
T_SPOUSE_PROOF = ("কাস্টমার উনার স্বামীর /স্ত্রীর স্টেটমেন্ট দিয়েছে, তাই প্রয়োজনীয় সম্পর্ক প্রমাণ (ম্যারেজ সার্টিফিকেট / "
                  "সন্তানের জন্ম নিবন্ধন / NID) সাবমিট করতে হবে, যা সাবমিট করা হয়নি অনুগ্রহ করে প্রয়োজনীয় তথ্য সহ "
                  "রিসাবমিট করুন।")
T_G_AGE_HIGH = ("জামিনদারের বয়স ৬২ বছরের বেশি। অনুগ্রহ করে জামিনদার পরিবর্তন করুন "
                "(শুধুমাত্র মা/বাবা/ভাই/বোন/স্বামী/স্ত্রী, বয়স ২১--৬২ বছর)।")
T_G_AGE_LOW = "জামিনদারের বয়স ২১ বছরের কম। অনুগ্রহ করে জামিনদার পরিবর্তন করুন ( বয়স ২১--৬২ বছর)।"
T_JOB_ID = ("কাস্টমার এর valid job id সাবমিট করুন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে job holder "
            "হিসেবে আবেদন করলে Job id দিতে হবে।")
T_LIC_NONE = ("Valid ট্রেড লাইসেন্সের কপি অথবা দোকানের সাইনবোর্ডের ছবি submit করুন। ক্যাশ কাউন্টারে বসা অবস্থায় "
              "কাস্টমারের ছবি দিন।")
T_LIC_EXPIRED = ("ট্রেড লাইসেন্স এর মেয়াদ উত্তীর্ণ হয়ে গেছে, অনুগ্রহ করে রিনিউ ট্রেড লাইসেন্স প্রদান করুন অথবা সাইন বোর্ড "
                 "সহ দোকানের ছবি submit করুন। ক্যাশ কাউন্টারে বসা অবস্থায় কাস্টমারের ছবি দিন।")

T_RIDER = ("কাস্টমার Rider হিসেবে আবেদন করেছেন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে Rider হিসেবে "
           "আবেদন করলে ৪০% down payment দিতে হবে। তা না হলে উনি ৫০ হাজার এর নিচের ফোন এর জন্য আবেদন করতে পারবেন।")
T_LANDOWNER = ("কাস্টমার একজন Land owner হিসেবে আবেদন করেছেন। পলিসি অনুযায়ী ৫০ হাজার এর বেশি দামি মোবাইল এর ক্ষেত্রে land "
               "owner হিসেবে আবেদন করলে মাসিক বাড়ি ভাড়া পাওয়ার রশিদ দিতে হবে। (কাস্টমার একজন বাড়ির মালিক এবং উনি বাড়ি "
               "ভাড়া পান সেই রশিদ)। তা না হলে কাস্টমার এই ফোন এর জন্য ৪০% downpayment দিয়ে নিতে পারবেন। আর সেটা না পারলে "
               "অনুগ্রহ করে ৫০ হাজার এর কমদামি ফোন এর জন্য আবেদন করুন।")
T_REL_REJECT = ("As the customer and the guarantor failed to provide consistent information regarding their relationship, "
                "the application has been rejected.")

_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]


def last_three_months(today: datetime | None = None) -> str:
    """'August, September, October' when today is in November (Bangladesh time)."""
    t = today or datetime.now(timezone(timedelta(hours=6)))
    out = []
    for k in (3, 2, 1):
        m, y = t.month - k, t.year
        while m <= 0:
            m += 12
            y -= 1
        out.append(_MONTHS[m - 1])
    return ", ".join(out)


def _i(text: str, msg: str | None = None) -> dict:
    return {"text": text, "msg": msg}


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
    """value >= threshold, allowing the small money tolerance (e.g. 1,950 counts as 2,000)."""
    return value is not None and value >= threshold - CONFIG["money_tolerance"]


def _fmt_age(a: float) -> str:
    y = int(a)
    m = int(round((a - y) * 12))
    if m == 12:
        y, m = y + 1, 0
    return f"{y}y {m}m"


def _best_month_floor(d):
    """Lowest value the best single month can have: max(stated, 3-month total / 3)."""
    vals = [x for x in (_num(d.get("tx_1_month")), (_num(d.get("tx_3_month")) or 0) / 3 or None) if x is not None]
    return max(vals) if vals else None


def _exempt_known(d):
    """High-MRP exemptions we can already confirm (without asking for down payment)."""
    tx3 = _num(d.get("tx_3_month")) or 0
    sal = _num(d.get("monthly_salary")) or 0
    dp = _num(d.get("down_payment_pct")) or 0
    return (
        dp >= CONFIG["dp_exempt_pct"]
        or _ge(tx3, CONFIG["tx3_exempt"])
        or (d.get("profession") in ("job_holder", "student")
            and d.get("salary_slip_submitted") is True and _ge(sal, CONFIG["salary_exempt"]))
    )


def _outside_hours(dt_str, note):
    """Return a reason string if salary slip was submitted outside working time."""
    if note in ("evening", "weekend", "holiday"):
        return f"submitted on {note}"
    if dt_str:
        try:
            dt = datetime.fromisoformat(str(dt_str).replace("Z", ""))
        except ValueError:
            return None
        start, end = CONFIG["business_hours"]
        if dt.weekday() in CONFIG["weekend_days"]:
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
    floor = _best_month_floor(d)

    if _num(d.get("customer_age")) is None:
        q.append(("customer_age", "Customer-er boyos koto?"))
    if prof is None:
        q.append(("profession", "Customer-er peshha ki? (job holder / student / businessman / rider / house owner / onno)"))
    if mrp is None:
        q.append(("mrp", "MRP koto taka?"))
    if floor is None or (not _ge(floor, CONFIG["min_month_tx"]) and _num(d.get("tx_1_month")) is None):
        q.append(("tx_1_month", "Shobcheye bhalo 1 mash-er bKash/bank transaction (cash in + cash out) koto?"))
    if d.get("name_mismatch") is True and d.get("guarantor_relation") is None:
        q.append(("guarantor_relation", "Name mismatch ache - guarantor customer-er ke hoy? (father/mother/brother/sister/spouse/onno)"))
    if d.get("guarantor_relation") == "spouse" and d.get("name_mismatch") is True and d.get("spouse_proof") is None:
        q.append(("spouse_proof", "Spouse-er jonno marriage certificate ba child-er NID/QR birth certificate ache?"))

    if mrp is not None and mrp >= CONFIG["high_mrp"] and prof:
        dp = _num(d.get("down_payment_pct"))
        if prof in ("job_holder", "student", "businessman") and tx3 is None:
            q.append(("tx_3_month", "MRP 50,000+; 3 mash-er total transaction koto?"))
        if prof in ("rider", "house_owner") and dp is None:
            if not (prof == "house_owner" and _ge(_num(d.get("rental_income")) or 0, CONFIG["rental_income_min"])):
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
    # de-duplicate, keep order
    seen, out = set(), []
    for k, v in q:
        if k not in seen:
            seen.add(k)
            out.append((k, v))
    return out


# ------------------------------------------------------------- main engine
def evaluate_application(data: dict) -> dict:
    d = {k: data.get(k) for k in FIELDS}
    rejects, returns, actions, ok, notes = [], [], [], [], []
    fast_track = False
    m3 = last_three_months()

    prof = d["profession"]
    gprof = d["guarantor_profession"]
    mrp = _num(d["mrp"])
    tx3 = _num(d["tx_3_month"])
    dp = _num(d["down_payment_pct"])
    cage = _num(d["customer_age"])
    gage = _num(d["guarantor_age"])

    # ---- 1. FRAUD / REJECT  (wording from the Issue Template "Reject Issue" section)
    for field, msg in REJECT_FLAGS:
        if _flag(d[field]):
            rejects.append(_i(msg))   # the official reject reason; UI offers a copy button
    for who, p in (("Customer", prof), ("Guarantor", gprof)):
        if p in NOT_SERVED:
            rejects.append(_i(f"{who} is in a NOT SERVED category: {NOT_SERVED[p]}."))
    if _flag(d["outside_address_area"]):
        rejects.append(_i("Applicant is outside the residential / permanent address area - not served."))

    tol = CONFIG["age_tolerance_years"]
    lo, hi = CONFIG["customer_age"]
    if cage is not None:
        if lo <= cage <= hi:
            ok.append(f"Customer age {_fmt_age(cage)} is within {lo}-{hi}.")
        elif lo - tol <= cage <= hi + tol:
            ok.append(f"Customer age {_fmt_age(cage)} accepted (within the 6-month margin of {lo}-{hi}).")
            notes.append(f"Customer age {_fmt_age(cage)} is outside {lo}-{hi} by less than 6 months - accepted.")
        else:
            rejects.append(_i(f"Customer age {_fmt_age(cage)} is outside {lo}-{hi}."))

    # ---- 1b. Guarantor age -> RETURN: BP must change the guarantor (Issue Template)
    lo, hi = CONFIG["guarantor_age"]
    if gage is not None:
        if lo <= gage <= hi:
            ok.append(f"Guarantor age {_fmt_age(gage)} is within {lo}-{hi}.")
        elif lo - tol <= gage <= hi + tol:
            ok.append(f"Guarantor age {_fmt_age(gage)} accepted (within the 6-month margin of {lo}-{hi}).")
            notes.append(f"Guarantor age {_fmt_age(gage)} is outside {lo}-{hi} by less than 6 months - accepted.")
        elif gage > hi:
            returns.append(_i(f"Guarantor age {_fmt_age(gage)} is above {hi} - guarantor must be changed.", T_G_AGE_HIGH))
        else:
            returns.append(_i(f"Guarantor age {_fmt_age(gage)} is below {lo} - guarantor must be changed.", T_G_AGE_LOW))

    # ---- 1c. Statement transactions -> RETURN: ask for another statement (Issue Template)
    floor = _best_month_floor(d)
    if floor is not None:
        if _ge(floor, CONFIG["min_month_tx"]):
            ok.append(f"At least one month has transactions >= BDT {CONFIG['min_month_tx']:,}.")
        else:
            returns.append(_i(
                f"No month reaches BDT {CONFIG['min_month_tx']:,} (best month ~{floor:,.0f}); "
                "the last 7 days before application are not counted. Ask for another statement.",
                T_TX_MONTH.format(m3=m3)))
        if _ge(floor, CONFIG["fast_track_tx"]):
            fast_track = True
    notes.append("Statement must cover the last 3 months; the last 7 days before application are not counted.")

    # ---- 1d. Relationship check during the call (nervous slips get one chance; no prompting)
    rc = d["relation_check"]
    prompting = _flag(d["side_prompting"])
    if rc == "major":
        rejects.append(_i(T_REL_REJECT))
    elif rc == "pending" and not prompting:
        actions.append(_i("Relationship answer is slightly different (e.g. chachato vs fufato bhai). The customer may be "
                          "nervous - give ONE chance to correct it, without hinting the answer. If corrected: accepted. "
                          "If the relationship is still different: reject."))
    elif rc == "corrected" and not prompting:
        ok.append("Small relationship slip was corrected by the customer himself - accepted.")
    if prompting:
        extra = (" The correction came while someone was prompting, so it does not count - ask again."
                 if rc == "corrected" else "")
        actions.append(_i("Someone nearby is telling the answers. Tell them to stop. Do not accept answers the customer "
                          "repeats after hearing them - ask again so the customer answers on his own." + extra))

    # ---- 1e. Notes when a money threshold was met only thanks to the small BDT margin
    mt = CONFIG["money_tolerance"]
    pairs = [("1-month transaction", floor, CONFIG["min_month_tx"]),
             ("1-month transaction (Fast-Track)", floor, CONFIG["fast_track_tx"])]
    if mrp is not None and mrp >= CONFIG["high_mrp"]:
        if prof in ("job_holder", "student", "businessman"):
            pairs += [("3-month transaction", tx3, CONFIG["high_mrp_tx3"]),
                      ("3-month transaction (exemption)", tx3, CONFIG["tx3_exempt"])]
        if prof in ("job_holder", "student"):
            pairs.append(("Monthly salary", _num(d["monthly_salary"]), CONFIG["salary_exempt"]))
        if prof == "house_owner":
            pairs.append(("Rental income", _num(d["rental_income"]), CONFIG["rental_income_min"]))
    for label, v, thr in pairs:
        if v is not None and thr - mt <= v < thr:
            notes.append(f"{label} {v:,.0f} is BDT {thr - v:,.0f} short of {thr:,} - accepted (margin: BDT {mt}).")

    if d["has_original_nid"] is False:
        returns.append(_i("Customer must provide the ORIGINAL NID (photocopy not accepted for customer).", T_NID_ORIG))

    # ---- 2. RETURN (salary slip)
    if _flag(d["salary_slip_submitted"]):
        why = _outside_hours(d["submission_datetime"], d["submission_note"])
        if why:
            returns.append(_i(f"Salary slip {why} - cannot be verified (business hours: 9 AM - 5 PM, working days).",
                              T_SLIP_HOURS))
        if _flag(d["salary_slip_handwritten"]):
            returns.append(_i("Salary slip has a handwritten signature/seal - not accepted. "
                              "An official company/business seal is required.", T_SLIP_BAD.format(m3=m3)))

    # ---- 3. NAME MISMATCH
    if _flag(d["name_mismatch"]):
        rel = d["guarantor_relation"]
        if rel in FIRST_BLOOD:
            ok.append(f"Name mismatch is acceptable: guarantor is first-blood relative ({rel}).")
        elif rel == "spouse":
            if d["spouse_proof"] in ("marriage_certificate", "child_nid", "qr_birth_certificate"):
                ok.append("Name mismatch is acceptable: spouse with valid proof.")
            else:
                returns.append(_i("Spouse statement needs a marriage certificate OR the children's NID / QR birth certificate.",
                                  T_SPOUSE_PROOF))
        elif rel is not None:
            returns.append(_i("Name mismatch: guarantor must be a first-blood relative "
                              "(father, mother, brother, sister) or a spouse with proof. Change the guarantor.",
                              T_G_NOT_FAMILY))

    # ---- 4. HIGH-MRP RULES
    if mrp is not None:
        if mrp < CONFIG["high_mrp"]:
            ok.append("MRP below 50,000 - basic requirements apply.")
            if _flag(d["statement_in_business_name"]) and d["trade_license_status"] != "valid":
                actions.append(_i("Statement is in a business name - a VALID trade license is required.", T_LIC_NONE))
        else:
            _high_mrp(d, prof, tx3, dp, ok, actions, notes)

    missing = find_missing(d)

    if rejects:
        status = STATUS_REJECTED
    elif returns:
        status = STATUS_RETURNED
    elif missing:
        status = STATUS_NEED_INFO
    elif actions:
        status = STATUS_ACTION
    else:
        status = STATUS_APPROVED

    return {
        "status": status,
        "rejects": rejects,
        "returns": returns,
        "actions": actions,
        "passed": ok,
        "notes": notes,
        "missing": missing,
        "fast_track": fast_track,
        "fast_track_msg": "Fast-Track Guarantor Check: ask only 2 questions - (1) Is the guarantor's phone reachable? "
                          "(2) Does the guarantor know the customer?" if fast_track else "",
    }


def _high_mrp(d, prof, tx3, dp, ok, actions, notes):
    CFG = CONFIG
    sug = "Otherwise reduce MRP below 50,000."
    dp_ok = dp is not None and dp >= CFG["dp_exempt_pct"]

    if prof in ("job_holder", "student"):
        if tx3 is not None:
            if _ge(tx3, CFG["high_mrp_tx3"]):
                ok.append(f"3-month transaction {tx3:,.0f} >= {CFG['high_mrp_tx3']:,}.")
            else:
                actions.append(_i(f"3-month transaction {tx3:,.0f} is below {CFG['high_mrp_tx3']:,}. Reduce MRP below 50,000.",
                                  T_TX3_15K))
        jid = d["job_id_status"]
        if _exempt_known(d):
            ok.append("Job ID not required (down payment >= 40% / 3-month tx >= 30,000 / valid salary slip > 25,000).")
        elif jid == "original":
            ok.append("Original Job ID card (hard copy) provided.")
        elif jid in ("work_photo", "visiting_card"):
            ok.append("No ID card, but work photo / visiting card accepted.")
        elif jid in ("photocopy", "none") or jid is not None:
            actions.append(_i("Original Job ID card (hard copy) required - scan/photocopy not accepted. "
                              "No ID? Work photo or visiting card is accepted. " + sug, T_JOB_ID))
    elif prof == "businessman":
        if tx3 is not None:
            if _ge(tx3, CFG["high_mrp_tx3"]):
                ok.append(f"3-month transaction {tx3:,.0f} >= {CFG['high_mrp_tx3']:,}.")
            else:
                actions.append(_i(f"3-month transaction {tx3:,.0f} is below {CFG['high_mrp_tx3']:,}. Reduce MRP below 50,000.",
                                  T_TX3_15K))
        lic = d["trade_license_status"]
        if _exempt_known(d) and lic != "valid":
            ok.append("Trade license not required (down payment >= 40% or 3-month tx >= 30,000).")
        elif lic == "valid":
            ok.append("Valid trade license provided.")
        elif lic == "expired":
            if d["has_shop_photos"] is True:
                ok.append("License expired, but 2 shop photos (signboard + owner at cash counter) provided.")
            elif d["has_shop_photos"] is False:
                actions.append(_i("License expired: take at least 2 shop photos with signboard and the owner at the cash counter.",
                                  T_LIC_EXPIRED))
        elif lic in ("none",):
            actions.append(_i("Valid trade license required (or down payment >= 40%, or 3-month tx >= 30,000). " + sug,
                              T_LIC_NONE))
    elif prof == "rider":
        if dp_ok:
            ok.append("Rider: down payment >= 40%.")
        elif dp is not None:
            actions.append(_i(f"Rider needs 40%+ down payment (got {dp:.0f}%). Otherwise eligible for MRP below 50,000 only.",
                              T_RIDER))
    elif prof == "house_owner":
        rent = _num(d["rental_income"])
        if _ge(rent, CFG["rental_income_min"]):
            ok.append(f"House owner: rental income {rent:,.0f} >= {CFG['rental_income_min']:,} - may apply for MRP >= 50,000 (proof required).")
        elif dp_ok:
            ok.append("House owner: down payment >= 40%.")
        elif dp is not None or rent is not None:
            actions.append(_i("House owner needs rental-income proof >= 25,000/month OR 40%+ down payment. " + sug,
                              T_LANDOWNER))
    else:
        actions.append(_i("Profession does not match any MRP >= 50,000 category. Reduce MRP below 50,000."))
