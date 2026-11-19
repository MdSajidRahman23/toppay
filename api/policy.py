"""Editable policy (the numbers behind every rule). Defaults live here; the admin can change any of them in the admin panel
and the change is saved in the database (key "toppay:policy") - no code edit, no redeploy.

Why: age limits, minimum amounts, MRP limits... change every month in the real SOP. Every number the engine uses is in SPEC.
Only numbers / switches are stored here, NEVER customer data.

effective() -> flat dict used by rules_engine (plus derived tuples: customer_age, guarantor_age, business_hours, weekend_days).
"""
import json
import time

import store

KEY = "toppay:policy"
CACHE_TTL = 15
LOG_MAX = 30

RELATIONS = {"father": "বাবা", "mother": "মা", "son": "ছেলে", "daughter": "মেয়ে", "brother": "ভাই", "sister": "বোন", "spouse": "স্বামী/স্ত্রী",
             "other_relative": "অন্য আত্মীয়", "friend": "বন্ধু", "colleague": "সহকর্মী"}
NOT_SERVED_LABELS = {
    "media_press": "Media / press", "ngo_loan": "Loan-দানকারী NGO কর্মী", "competitor": "Competitor / অন্য installment কর্মী",
    "defense": "Defense / Police / Military", "lawyer": "Lawyer", "disabled": "প্রতিবন্ধী ব্যক্তি",
}
DAYS = {0: "সোম", 1: "মঙ্গল", 2: "বুধ", 3: "বৃহস্পতি", 4: "শুক্র", 5: "শনি", 6: "রবি"}

# type: int | float | bool | multi.   min/max = allowed range.   {key, group, label, type, default, min, max, unit, help}
SPEC = [
    # --- Age
    {"key": "customer_age_min", "group": "বয়স", "label": "Customer-এর ন্যূনতম বয়স", "type": "int", "default": 19, "min": 10, "max": 100, "unit": "বছর"},
    {"key": "customer_age_max", "group": "বয়স", "label": "Customer-এর সর্বোচ্চ বয়স", "type": "int", "default": 62, "min": 10, "max": 100, "unit": "বছর"},
    {"key": "guarantor_age_min", "group": "বয়স", "label": "Guarantor-এর ন্যূনতম বয়স", "type": "int", "default": 21, "min": 10, "max": 100, "unit": "বছর"},
    {"key": "guarantor_age_max", "group": "বয়স", "label": "Guarantor-এর সর্বোচ্চ বয়স", "type": "int", "default": 62, "min": 10, "max": 100, "unit": "বছর"},
    {"key": "age_tolerance_years", "group": "বয়স", "label": "বয়সের margin (দশমিক বছর, ০.৫ = ৬ মাস)", "type": "float", "default": 0.5, "min": 0, "max": 2, "unit": "বছর",
     "help": "Internal: সীমার এত কাছে থাকলে গ্রহণ করা হয়, BP-কে বলা হয় না।"},
    # --- Statement / money
    {"key": "statement_months", "group": "Statement ও লেনদেন", "label": "কত মাসের statement লাগবে", "type": "int", "default": 3, "min": 1, "max": 12, "unit": "মাস"},
    {"key": "min_month_tx", "group": "Statement ও লেনদেন", "label": "ন্যূনতম লেনদেন (যেকোনো ১ মাসে cash-in বা cash-out)", "type": "int", "default": 2000, "min": 0, "max": 10000000, "unit": "৳",
     "help": "Cash-in ও cash-out আলাদা ধরা হয়, যোগ করা হয় না।"},
    {"key": "fast_track_tx", "group": "Statement ও লেনদেন", "label": "Fast-track লেনদেন (১ মাসে)", "type": "int", "default": 6000, "min": 0, "max": 10000000, "unit": "৳"},
    {"key": "money_tolerance", "group": "Statement ও লেনদেন", "label": "টাকার tolerance (এত কম থাকলেও গ্রহণযোগ্য)", "type": "int", "default": 60, "min": 0, "max": 1000, "unit": "৳",
     "help": "২,০০০ − ৬০ = ১,৯৪০ হলেও পাস। MRP-তে এই tolerance নেই।"},
    {"key": "exclude_last_days", "group": "Statement ও লেনদেন", "label": "আবেদনের আগের কত দিনের লেনদেন বাদ", "type": "int", "default": 7, "min": 0, "max": 31, "unit": "দিন", "help": "Statement Checker-এ কাজে লাগে।"},
    # --- MRP
    {"key": "mrp_factor", "group": "MRP", "label": "MRP = Total Product Amount × ?", "type": "float", "default": 0.9, "min": 0.1, "max": 1, "unit": "গুণক"},
    {"key": "high_mrp", "group": "MRP", "label": "'বেশি MRP' শুরু (এর সমান বা বেশি হলে বাড়তি নিয়ম)", "type": "int", "default": 50000, "min": 0, "max": 10000000, "unit": "৳"},
    {"key": "high_mrp_tx3", "group": "MRP", "label": "বেশি MRP: ৩ মাসের মোট লেনদেন (in+out যোগ)", "type": "int", "default": 15000, "min": 0, "max": 10000000, "unit": "৳"},
    {"key": "tx3_exempt", "group": "MRP", "label": "৩ মাসের মোট এর বেশি হলে Job ID / Trade license ছাড়", "type": "int", "default": 30000, "min": 0, "max": 10000000, "unit": "৳"},
    {"key": "dp_exempt_pct", "group": "MRP", "label": "Down payment ছাড় (%)", "type": "int", "default": 40, "min": 0, "max": 100, "unit": "%"},
    {"key": "dp40_short_guarantor_call", "group": "MRP", "label": "ছাড়ের down payment হলে guarantor call ছোট (internal note)", "type": "bool", "default": True},
    {"key": "salary_exempt", "group": "MRP", "label": "Salary slip-এর বেতন ছাড় (মাসে)", "type": "int", "default": 25000, "min": 0, "max": 10000000, "unit": "৳"},
    {"key": "rental_income_min", "group": "MRP", "label": "House owner-এর ন্যূনতম ভাড়ার আয় (মাসে)", "type": "int", "default": 25000, "min": 0, "max": 10000000, "unit": "৳"},
    # --- Time
    {"key": "business_start", "group": "অফিস সময় (Salary slip)", "label": "অফিস শুরু (২৪ ঘণ্টা)", "type": "int", "default": 9, "min": 0, "max": 23, "unit": "ঘণ্টা"},
    {"key": "business_end", "group": "অফিস সময় (Salary slip)", "label": "অফিস শেষ (২৪ ঘণ্টা)", "type": "int", "default": 17, "min": 1, "max": 24, "unit": "ঘণ্টা"},
    {"key": "weekend_days", "group": "অফিস সময় (Salary slip)", "label": "সাপ্তাহিক ছুটি", "type": "multi", "default": [4, 5], "choices": {str(k): v for k, v in DAYS.items()}},
    # --- Who is allowed
    {"key": "first_blood", "group": "সম্পর্ক ও সেবার বাইরের পেশা", "label": "Name mismatch হলেও চলবে এমন সম্পর্ক (first blood)", "type": "multi",
     "default": ["father", "mother", "son", "daughter", "brother", "sister"], "choices": RELATIONS, "help": "Spouse আলাদা নিয়মে (প্রমাণসহ) চলে।"},
    {"key": "not_served", "group": "সম্পর্ক ও সেবার বাইরের পেশা", "label": "Reject হবে এমন পেশা (NOT SERVED)", "type": "multi",
     "default": list(NOT_SERVED_LABELS), "choices": NOT_SERVED_LABELS},
]
BY_KEY = {s["key"]: s for s in SPEC}
DEFAULTS = {s["key"]: s["default"] for s in SPEC}

_cache = {"t": 0.0, "rec": None}


class PolicyError(Exception):
    """Something the admin should see (bad value, database missing...)."""


def _stored() -> dict:
    if not store.backend():
        return {}
    raw = store.get(KEY)
    return json.loads(raw) if raw else {}


def _rec(force=False) -> dict:
    now = time.time()
    if not force and _cache["rec"] is not None and now - _cache["t"] < CACHE_TTL:
        return _cache["rec"]
    try:
        rec = _stored()
    except store.StoreUnavailable:
        rec = _cache["rec"] if _cache["rec"] is not None else {}   # keep the last known value
    _cache.update(t=now, rec=rec)
    return rec


def invalidate():
    _cache.update(t=0.0, rec=None)


def _coerce(spec: dict, v):
    t = spec["type"]
    if t == "bool":
        if isinstance(v, bool):
            return v
        raise PolicyError(f"\"{spec['label']}\": হ্যাঁ/না হতে হবে।")
    if t == "multi":
        if not isinstance(v, list) or any(str(x) not in spec["choices"] for x in v):
            raise PolicyError(f"\"{spec['label']}\": ভুল তালিকা।")
        out = [int(x) if spec["key"] == "weekend_days" else str(x) for x in v]
        return sorted(set(out)) if spec["key"] == "weekend_days" else list(dict.fromkeys(out))
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise PolicyError(f"\"{spec['label']}\": সংখ্যা দিন।")
    v = int(v) if t == "int" and float(v).is_integer() else float(v)
    if t == "int" and not isinstance(v, int):
        raise PolicyError(f"\"{spec['label']}\": পূর্ণ সংখ্যা দিন।")
    if not (spec["min"] <= v <= spec["max"]):
        raise PolicyError(f"\"{spec['label']}\": {spec['min']} থেকে {spec['max']}-এর মধ্যে হতে হবে।")
    return v


def _cross_check(vals: dict):
    if vals["customer_age_min"] >= vals["customer_age_max"]:
        raise PolicyError("Customer-এর ন্যূনতম বয়স সর্বোচ্চের চেয়ে কম হতে হবে।")
    if vals["guarantor_age_min"] >= vals["guarantor_age_max"]:
        raise PolicyError("Guarantor-এর ন্যূনতম বয়স সর্বোচ্চের চেয়ে কম হতে হবে।")
    if vals["business_start"] >= vals["business_end"]:
        raise PolicyError("অফিস শুরুর সময় শেষের আগে হতে হবে।")
    if vals["fast_track_tx"] < vals["min_month_tx"]:
        raise PolicyError("Fast-track লেনদেন ন্যূনতম লেনদেনের চেয়ে কম হতে পারে না।")
    if vals["tx3_exempt"] < vals["high_mrp_tx3"]:
        raise PolicyError("৩ মাসের ছাড়ের সীমা (Job ID/License) বেশি-MRP-এর ৩ মাসের সীমার চেয়ে কম হতে পারে না।")


def values() -> dict:
    """Flat effective values: defaults overlaid with what the admin saved (invalid saved values are ignored)."""
    out = dict(DEFAULTS)
    for k, v in (_rec().get("values") or {}).items():
        if k in BY_KEY:
            try:
                out[k] = _coerce(BY_KEY[k], v)
            except PolicyError:
                pass
    return out


def effective() -> dict:
    """What the rule engine reads: flat values + derived forms."""
    v = values()
    v["customer_age"] = (v["customer_age_min"], v["customer_age_max"])
    v["guarantor_age"] = (v["guarantor_age_min"], v["guarantor_age_max"])
    v["business_hours"] = (v["business_start"], v["business_end"])
    v["weekend_days"] = tuple(v["weekend_days"])
    v["first_blood"] = set(v["first_blood"])
    v["not_served_on"] = set(v["not_served"])
    return v


def public() -> dict:
    """For the browser (any logged-in user): the numbers the UI itself needs."""
    v = values()
    return {k: v[k] for k in ("mrp_factor", "min_month_tx", "fast_track_tx", "money_tolerance", "exclude_last_days", "statement_months")}


def template_context() -> dict:
    """Placeholders templates may use, so a message follows the policy: {c_age_min} {c_age_max} {g_age_min} {g_age_max} {min_tx} {fast_tx} {high_mrp}."""
    v = values()
    return {"c_age_min": v["customer_age_min"], "c_age_max": v["customer_age_max"], "g_age_min": v["guarantor_age_min"],
            "g_age_max": v["guarantor_age_max"], "min_tx": f"{v['min_month_tx']:,}", "fast_tx": f"{v['fast_track_tx']:,}",
            "high_mrp": f"{v['high_mrp']:,}", "dp_pct": v["dp_exempt_pct"], "months": v["statement_months"]}


def info(admin: bool) -> dict:
    rec = _rec()
    out = {"spec": SPEC if admin else None, "values": values(), "defaults": DEFAULTS,
           "changed": sorted((rec.get("values") or {}).keys()), "by": rec.get("by"), "at": rec.get("at"),
           "storage": store.backend()}
    if admin:
        out["log"] = rec.get("log", [])
    return out


def save(changes: dict, by: str):
    """Change some values. Everything is validated first; nothing is saved if one value is wrong."""
    if store.backend() is None:
        raise PolicyError("Database যুক্ত নেই, তাই নীতি বদলানো যাবে না।")
    if not isinstance(changes, dict) or not changes:
        raise PolicyError("কিছু বদলানো হয়নি।")
    new = {}
    for k, v in changes.items():
        if k not in BY_KEY:
            raise PolicyError("অচেনা সেটিং: " + str(k)[:40])
        new[k] = _coerce(BY_KEY[k], v)
    rec = _stored()
    stored = dict(rec.get("values") or {})
    before = values()
    after = dict(before)
    after.update(new)
    _cross_check(after)
    diff = {}
    for k, v in new.items():
        if before[k] != v:
            diff[k] = [before[k], v]
        if v == DEFAULTS[k]:
            stored.pop(k, None)           # equal to the default -> nothing to remember
        else:
            stored[k] = v
    if not diff:
        return diff
    log = ([{"at": int(time.time()), "by": by, "changes": diff}] + rec.get("log", []))[:LOG_MAX]
    store.set(KEY, json.dumps({"values": stored, "by": by, "at": int(time.time()), "log": log}, ensure_ascii=False))
    invalidate()
    return diff


def reset(keys, by: str):
    """Back to the default for the given keys (or all keys when keys is None)."""
    if store.backend() is None:
        raise PolicyError("Database যুক্ত নেই।")
    rec = _stored()
    stored = dict(rec.get("values") or {})
    ks = list(stored) if keys is None else [k for k in keys if k in stored]
    before = values()
    diff = {}
    for k in ks:
        stored.pop(k, None)
        if before[k] != DEFAULTS[k]:
            diff[k] = [before[k], DEFAULTS[k]]
    log = rec.get("log", [])
    if diff:
        log = ([{"at": int(time.time()), "by": by, "changes": diff, "reset": True}] + log)[:LOG_MAX]
    store.set(KEY, json.dumps({"values": stored, "by": by, "at": int(time.time()), "log": log}, ensure_ascii=False))
    invalidate()
    return diff
