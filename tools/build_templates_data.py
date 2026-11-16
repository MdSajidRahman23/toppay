"""One-time generator: legacy templates (no IDs) + engine texts + curated extras -> api/templates_data.py (with stable IDs).
Run:  python tools/build_templates_data.py
IDs are position based ("stm.04") and NEVER reused. To add a template later, append a new ID in api/templates_data.py by hand.
"""
import json, os, re, sys, importlib.util, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


old_t = load(os.path.join(HERE, "legacy", "templates_data_v1.py"), "old_t").TEMPLATES
sys.path.insert(0, os.path.join(HERE, "legacy"))
old_e = load(os.path.join(HERE, "legacy", "rules_engine_v1.py"), "old_e")

PREFIX = {"address": "adr", "contact": "con", "statement": "stm", "nid": "nid", "guarantor": "gua",
          "job": "job", "business": "biz", "reject": "rej"}
TITLE_ADD = {}


def norm(s):
    s = unicodedata.normalize("NFD", s)
    return re.sub(r"[\s\*\.,।\-–—()\[\]\"'“”‘’:;!?`]+", "", s).lower()


def placeholders(t):
    """Month names -> placeholders so the text stays correct every month (same replacements the old JS did)."""
    t = re.sub(r"August, September, October", "{m3}", t)
    t = re.sub(r"May, June,\s?July", "{m3}", t)
    t = re.sub(r"জুলাই,\s?আগষ্ট,\s?সেপ্টেম্বর", "{m3_bn}", t)
    t = re.sub(r"জুলাই অগাস্ট সেপ্টেম্বর", "{m3_bn_sp}", t)
    t = re.sub(r"আগস্ট এর ১ তারিখ", "{m1_bn} এর ১ তারিখ", t)
    t = re.sub(r"১লা আগস্ট", "১লা {m1_bn}", t)
    return t


sections = []
by_norm = {}
for sec in old_t["sections"]:
    items = []
    for i, text in enumerate(sec["items"], 1):
        tid = f"{PREFIX[sec['id']]}.{i:02d}"
        items.append({"id": tid, "text": placeholders(text)})
        by_norm[norm(placeholders(text))] = tid
    sections.append({"id": sec["id"], "title": sec["title"], "kind": sec["kind"], "items": items})
sec_by_id = {s["id"]: s for s in sections}


def add(section, text, **extra):
    """Add a new built-in template (or reuse an identical one). Returns its id."""
    k = norm(text)
    if k in by_norm:
        return by_norm[k]
    sec = sec_by_id[section]
    n = max(int(it["id"].split(".")[1]) for it in sec["items"]) + 1
    tid = f"{PREFIX[section]}.{n:02d}"
    sec["items"].append(dict({"id": tid, "text": text}, **extra))
    by_norm[k] = tid
    return tid


MAP = {}   # engine key -> template id
# ---- return messages used by the engine (old T_* constants)
ENG = [
    ("tx_month_old", "statement", old_e.T_TX_MONTH.replace("{m3}", "{m3}"), {}),
    ("tx3_15k", "job", old_e.T_TX3_15K, {}),
    ("slip_hours", "statement", old_e.T_SLIP_HOURS, {}),
    ("slip_bad", "statement", old_e.T_SLIP_BAD.replace("{m3}", "{m3}"), {}),
    ("nid_name_c", "nid", old_e.T_NID_NAME_C, {}),
    ("nid_name_g", "nid", old_e.T_NID_NAME_G, {}),
    ("office_phone", "contact", old_e.T_OFFICE_PHONE, {"source": "engine"}),
    ("g_no_prof", "guarantor", old_e.T_G_NO_PROF, {"source": "engine"}),
    ("nid_orig", "nid", old_e.T_NID_ORIG, {}),
    ("g_not_family", "guarantor", old_e.T_G_NOT_FAMILY, {}),
    ("spouse_proof", "statement", old_e.T_SPOUSE_PROOF, {}),
    ("g_age_high", "guarantor", old_e.T_G_AGE_HIGH, {}),
    ("g_age_low", "guarantor", old_e.T_G_AGE_LOW, {}),
    ("job_id", "job", old_e.T_JOB_ID, {}),
    ("lic_none", "business", old_e.T_LIC_NONE, {}),
    ("lic_expired", "business", old_e.T_LIC_EXPIRED, {}),
    ("rider", "business", old_e.T_RIDER, {}),
    ("landowner", "business", old_e.T_LANDOWNER, {}),
]
for key, sec, text, extra in ENG:
    MAP[key] = add(sec, placeholders(text) if "{m3}" not in text else text, **extra)

# SOP change (Nov 2026): cash-in OR cash-out, each direction separately (not the sum). New wording, old one stays.
MAP["tx_month"] = add(
    "statement",
    "গত ৩ মাসের ({m3}) স্টেটমেন্টে প্রয়োজনীয় লেনদেন পাওয়া যায়নি (আবেদন এর দিন থেকে গত ৭ দিন বাদ এ "
    "যে কোন এক মাসে ক্যাশ ইন অথবা ক্যাশ আউট (আলাদাভাবে, যোগ করে নয়) কমপক্ষে ২০০০ টাকা)। অনুগ্রহ করে গ্রাহকের অন্য "
    "স্টেটমেন্ট বিকাশ/নগদ/ব্যাংক স্টেটমেন্ট এই এমাউন্টের লেনদেন আছে সেই স্টেটমেন্ট সাবমিট করুন।",
    source="engine", changed=True)

# ---- reject reasons used by the engine (old REJECT_FLAGS texts)
for flag, text in old_e.REJECT_FLAGS:
    MAP["flag:" + flag] = add("reject", text, **({} if norm(text) in by_norm else {"source": "engine"}))
MAP["rel_reject"] = add("reject", old_e.T_REL_REJECT, source="engine")
MAP["not_served"] = add("reject", "{who} is in a NOT SERVED category: {category}.", source="engine")
MAP["outside_area"] = add("reject", "Applicant is outside the residential / permanent address area - not served.", source="engine")
MAP["age_customer"] = add("reject", "The customer's age ({age}) is outside the allowed range ({range}).", source="engine")

# ---- curated extras from the real return-reason dump (marked "new" so Sajid can review)
extra_path = os.path.join(HERE, "extra_templates.json")
if os.path.exists(extra_path):
    for e in json.load(open(extra_path, encoding="utf-8")):
        tid = add(e["section"], e["text"], new=True, source="dump", seen=e.get("seen"))
        e["id"] = tid

# placeholders fix-ups for blanks that were left as "-" in the official reject text
for sec in sections:
    for it in sec["items"]:
        it["text"] = it["text"].replace("The original statement holder's name is", "The original statement holder's name is {holder}") \
            if it["text"].endswith("The original statement holder's name is") else it["text"]
        it["text"] = it["text"].replace("has a -month overdue", "has a {months}-month overdue")

data = {"sections": sections}
out = os.path.join(ROOT, "api", "templates_data.py")
with open(out, "w", encoding="utf-8") as f:
    f.write('"""Built-in BP message library (safe fallback). Stable IDs: section prefix + number, never reused.\n'
            'Placeholders: {m3} {m3_bn} {m3_bn_sp} {m1_bn} are filled automatically; any other {name} is typed by the reviewer.\n'
            'Items marked "new": true came from the real return-reason dump and wait for your review.\n"""\n'
            'import json\n\n_RAW = r\'\'\'')
    json.dump(data, f, ensure_ascii=False, indent=1)
    f.write("'''\n\nTEMPLATES = json.loads(_RAW)\n\n"
            "# flat view: id -> {id, section, kind, title, text, ...}\nBUILTIN = {}\nfor _s in TEMPLATES['sections']:\n"
            "    for _it in _s['items']:\n        BUILTIN[_it['id']] = dict(_it, section=_s['id'], kind=_s['kind'], section_title=_s['title'])\n")
json.dump(MAP, open(os.path.join(HERE, "out", "engine_map.json"), "w"), indent=1) if os.path.isdir(os.path.join(HERE, "out")) else None
print(json.dumps(MAP, indent=1))
print(sum(len(s["items"]) for s in sections), "templates")
