"""Builds the full answer for one case: automatic reasons (from the rules engine) + manual reasons + dismissals,
with the text of every reason looked up from the template store. No customer data is kept anywhere."""
import re

import templates_store as ts
from rules_engine import FIELDS, combine_status, evaluate_application

_BN = re.compile(r"[\u0980-\u09FF]")
MAX_MANUAL = 60
MAX_DISMISSED = 100


def _clean_manual(manual) -> list:
    out, seen = [], set()
    for m in (manual or [])[:MAX_MANUAL]:
        tid = m.get("tid") if isinstance(m, dict) else m
        if not isinstance(tid, str) or tid in seen:
            continue
        meta = ts.meta(tid)
        if meta and ts.is_usable(tid):
            seen.add(tid)
            kind = meta["kind"]
            want = m.get("kind") if isinstance(m, dict) else None
            if want in ("return", "reject"):
                kind = want
                # a reject reason is always English: a Bangla message can only be a return reason
                if kind == "reject" and _BN.search(ts.effective_text(tid) or ""):
                    kind = "return"
            out.append({"tid": tid, "kind": kind, "section": meta["section"]})
    return out


def build_case(data: dict, manual=None, dismissed=None) -> dict:
    data = {k: (data or {}).get(k) for k in FIELDS}
    res = evaluate_application(data)
    ctx = ts.tpl_context()
    man = _clean_manual(manual)
    dis = [k for k in (dismissed or [])[:MAX_DISMISSED] if isinstance(k, str) and len(k) < 80]

    reasons = []
    for r in res["reasons"]:
        raw = ts.effective_text(r["tid"]) if r["tid"] else None
        reasons.append({
            "id": r["key"], "source": "auto", "kind": r["kind"], "tid": r["tid"], "params": r["params"], "why": r["why"],
            "template": raw, "text": ts.render(raw, r["params"], ctx) if raw else None,
            "dismissed": r["key"] in dis,
        })
    for m in man:
        raw = ts.effective_text(m["tid"])
        reasons.append({
            "id": "manual:" + m["tid"], "source": "manual", "kind": m["kind"], "tid": m["tid"], "params": {},
            "why": "Added by the reviewer", "template": raw, "text": ts.render(raw, {}, ctx), "dismissed": False,
        })
    combo = combine_status(res["reasons"], man, dis, res["missing"])
    return {
        "api_version": 2,
        "status": combo["status"],
        "status_detail": {"active": combo["active"], "dismissed": combo["dismissed"]},
        "reasons": reasons,
        "passed": res["passed"], "notes": res["notes"], "missing": res["missing"],
        "fast_track": res["fast_track"], "fast_track_msg": res["fast_track_msg"],
        "context": ctx,
    }
