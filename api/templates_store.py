"""Template store: built-in (templates_data.py, safe fallback) + GLOBAL layer (admin edits, saved in the database).
The third layer (a user's LOCAL edit) lives only in that user's browser and never reaches this file.
Precedence on a PC:  local  >  global  >  built-in.

Global record (one per template id, in the hash "toppay:tpl:global"):
    {"text": "...", "hidden": bool, "custom": bool, "section": "...", "by": "admin", "at": 1700000000}
  - built-in id + text   = admin edited the wording
  - built-in id + hidden = admin hid it from users (not allowed for templates the rule engine needs)
  - custom id (cus.NNN)  = a template the admin added
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone

import store
from templates_data import BUILTIN, TEMPLATES
import indicators

indicators.merge(TEMPLATES, BUILTIN)      # official Quality Indicator templates (qi.NN) join the library

KEY = "toppay:tpl:global"
SEQ = "toppay:tpl:seq"
MAX_LEN = 2000
_BN = re.compile(r"[ঀ-৿]")
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
_MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"]
_PH = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


class TemplateError(Exception):
    """A problem the admin should see (bad text, unknown id...)."""


# ------------------------------------------------------------------ placeholders
def tpl_context(now: datetime | None = None) -> dict:
    """Automatic placeholder values (Bangladesh time): the last three FULL months."""
    t = now or datetime.now(timezone(timedelta(hours=6)))
    idx = [((t.month - 1 - k) % 12) for k in (3, 2, 1)]
    en = [_MONTHS[i] for i in idx]
    bn = [_MONTHS_BN[i] for i in idx]
    ctx = {"m3": ", ".join(en), "m3_bn": ", ".join(bn), "m3_bn_sp": " ".join(bn), "m1_bn": bn[0], "m1": en[0]}
    try:
        import policy
        ctx.update(policy.template_context())      # {c_age_min} {g_age_max} {min_tx} ... follow the admin-edited policy
    except Exception:  # never let a policy problem break the template library
        pass
    return ctx


def placeholders(text: str) -> list:
    seen = []
    for m in _PH.findall(text or ""):
        if m not in seen:
            seen.append(m)
    return seen


def render(text: str, params: dict | None = None, ctx: dict | None = None) -> str:
    """Replace {name} when a value is known; unknown placeholders stay (the reviewer types them in the browser)."""
    vals = dict(ctx or {})
    vals.update(params or {})
    return _PH.sub(lambda m: str(vals[m.group(1)]) if m.group(1) in vals else m.group(0), text or "")


# ------------------------------------------------------------------ validation
def validate_text(text, kind: str) -> str:
    if not isinstance(text, str):
        raise TemplateError("Text দিতে হবে।")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise TemplateError("Text খালি রাখা যাবে না।")
    if len(text) > MAX_LEN:
        raise TemplateError(f"Text {MAX_LEN} অক্ষরের বেশি হতে পারবে না।")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
        raise TemplateError("Text-এ অচেনা control character আছে।")
    if "<" in text or ">" in text:
        raise TemplateError("< এবং > চিহ্ন ব্যবহার করা যাবে না (HTML দেওয়া যায় না)।")
    if kind == "reject" and _BN.search(text):
        raise TemplateError("Reject reason সবসময় English হতে হবে - বাংলা অক্ষর দেওয়া যাবে না।")
    return text


# ------------------------------------------------------------------ global layer
_cache = {"t": 0.0, "v": {}}
CACHE_TTL = 15


def _global() -> dict:
    now = time.time()
    if now - _cache["t"] < CACHE_TTL:
        return _cache["v"]
    try:
        raw = store.hgetall(KEY) if store.backend() else {}
    except store.StoreUnavailable:
        return _cache["v"]          # database down: keep the last known layer, never break the check
    _cache["v"] = {k: json.loads(v) for k, v in raw.items()}
    _cache["t"] = now
    return _cache["v"]


def invalidate():
    _cache["t"] = 0.0


def engine_ids() -> set:
    from rules_engine import FLAG_TID, TID
    return set(TID.values()) | set(FLAG_TID.values())


def _section(sec_id: str):
    for s in TEMPLATES["sections"]:
        if s["id"] == sec_id:
            return s
    raise TemplateError("এই section নেই।")


def meta(tid: str) -> dict | None:
    """Section/kind of any template id (built-in or custom) or None."""
    if tid in BUILTIN:
        b = BUILTIN[tid]
        return {"section": b["section"], "kind": b["kind"]}
    g = _global().get(tid)
    if g and g.get("custom"):
        return {"section": g["section"], "kind": _section(g["section"])["kind"]}
    return None


def effective_text(tid: str) -> str | None:
    """Text of a template for the engine / picker: global edit if there is one, else the built-in text."""
    g = _global().get(tid)
    if g and g.get("text"):
        return g["text"]
    b = BUILTIN.get(tid)
    return b["text"] if b else None


def is_usable(tid: str) -> bool:
    """May a reviewer add this template by hand? (exists and not hidden by the admin)"""
    if meta(tid) is None:
        return False
    g = _global().get(tid) or {}
    return not g.get("hidden")


def catalog(include_hidden: bool = False) -> dict:
    """The whole library as the API returns it: sections -> items with built-in text, global text and flags."""
    g = _global()
    sections = []
    for s in TEMPLATES["sections"]:
        items = []
        for it in s["items"]:
            rec = g.get(it["id"]) or {}
            hidden = bool(rec.get("hidden"))
            if hidden and not include_hidden:
                continue
            items.append({
                "id": it["id"], "text": rec.get("text") or it["text"], "builtin_text": it["text"],
                "overridden": bool(rec.get("text")) and rec.get("text") != it["text"], "custom": False, "hidden": hidden,
                "new": bool(it.get("new")), "changed": bool(it.get("changed")), "engine": it["id"] in engine_ids(),
                "edited_by": rec.get("by"), "edited_at": rec.get("at") if rec.get("text") else None,
            })
        for tid, rec in sorted(g.items()):
            if rec.get("custom") and rec.get("section") == s["id"]:
                if rec.get("hidden") and not include_hidden:
                    continue
                items.append({"id": tid, "text": rec["text"], "builtin_text": None, "overridden": False, "custom": True,
                              "hidden": bool(rec.get("hidden")), "new": False, "changed": False, "engine": False,
                              "edited_by": rec.get("by"), "edited_at": rec.get("at")})
        sections.append({"id": s["id"], "title": s["title"], "kind": s["kind"], "items": items})
    return {"sections": sections, "context": tpl_context(), "indicators": indicators.payload()}


# ---- admin writes (the API layer checks the role and the rate limit first)
def _put(tid, rec):
    store.hset(KEY, tid, json.dumps(rec, ensure_ascii=False))
    invalidate()


def set_text(tid: str, text: str, by: str):
    m = meta(tid)
    if not m:
        raise TemplateError("Template পাওয়া যায়নি।")
    text = validate_text(text, m["kind"])
    rec = dict(_global().get(tid) or {})
    if tid in BUILTIN and text == BUILTIN[tid]["text"]:
        rec.pop("text", None); rec.pop("by", None); rec.pop("at", None)      # same as built-in = no override
        if not rec:
            store.hdel(KEY, tid); invalidate(); return
        _put(tid, rec); return
    rec.update({"text": text, "by": by, "at": int(time.time())})
    if tid not in BUILTIN:
        rec["custom"] = True
        rec.setdefault("section", m["section"])
    _put(tid, rec)


def create_custom(section: str, text: str, by: str) -> str:
    sec = _section(section)
    text = validate_text(text, sec["kind"])
    n = store.incr(SEQ)
    tid = f"cus.{n:03d}"
    _put(tid, {"text": text, "custom": True, "section": section, "by": by, "at": int(time.time())})
    return tid


def set_hidden(tid: str, hidden: bool, by: str):
    if meta(tid) is None:
        raise TemplateError("Template পাওয়া যায়নি।")
    if hidden and tid in engine_ids():
        raise TemplateError("এই template টা rule engine নিজে ব্যবহার করে, তাই hide করা যাবে না (text বদলাতে পারেন)।")
    rec = dict(_global().get(tid) or {})
    if hidden:
        rec.update({"hidden": True, "by": rec.get("by") or by, "at": rec.get("at") or int(time.time())})
        _put(tid, rec)
    else:
        rec.pop("hidden", None)
        if rec and (rec.get("text") or rec.get("custom")):
            _put(tid, rec)
        else:
            store.hdel(KEY, tid); invalidate()


def delete_custom(tid: str):
    rec = _global().get(tid)
    if not rec or not rec.get("custom"):
        raise TemplateError("শুধু নিজের যোগ করা template মোছা যায়। Built-in হলে Hide করুন।")
    store.hdel(KEY, tid)
    invalidate()


def reset_builtin(tid: str):
    if tid not in BUILTIN:
        raise TemplateError("Reset শুধু built-in template-এর জন্য।")
    rec = dict(_global().get(tid) or {})
    for k in ("text", "by", "at"):
        rec.pop(k, None)
    if rec:
        _put(tid, rec)
    else:
        store.hdel(KEY, tid); invalidate()
