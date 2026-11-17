"""FastAPI backend for TopPay Smart Decision Assistant (Vercel-ready).  Contract: see API.md
Local:   python -m uvicorn api.index:app --reload     -> http://127.0.0.1:8000
Vercel:  routed through vercel.json; static files are served from /public.
"""
import os
import sys
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import re  # noqa: E402
import smtplib  # noqa: E402
import time  # noqa: E402
from email.message import EmailMessage  # noqa: E402

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import policy  # noqa: E402
import sharedlogin  # noqa: E402
import store  # noqa: E402
import templates_store as ts  # noqa: E402
from auth import (  # noqa: E402
    admin_name, admin_uses_defaults, check_credentials, client_ip, make_token, rate_limit, require_admin,
    require_login, secret_is_default,
)
from case import build_case  # noqa: E402
from rules_engine import FIELDS  # noqa: E402

app = FastAPI(title="TopPay Smart Decision Assistant")


def _check_pin(pin: Optional[str]):
    """Optional access PIN: set APP_PIN env var to protect your AI quota."""
    need = os.getenv("APP_PIN")
    if need and pin != need:
        raise HTTPException(status_code=401, detail="PIN ভুল বা দেওয়া হয়নি।")


class AnalyzeIn(BaseModel):
    text: str
    data: dict = {}


class ManualIn(BaseModel):
    tid: str
    kind: Optional[str] = None      # "return" | "reject"; default = the template's own section kind


class CheckIn(BaseModel):
    data: dict
    manual: List[ManualIn] = []     # reasons the reviewer added by hand
    dismissed: List[str] = []       # keys of automatic reasons the reviewer switched off


class LoginIn(BaseModel):
    username: str
    password: str


class FeedbackIn(BaseModel):
    email: str
    message: str
    website: str = ""   # honeypot: real users never fill this


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/login")
def login(body: LoginIn, request: Request):
    ip = client_ip(request)
    if not rate_limit("login:" + ip, 8, 600) or not rate_limit("login:all", 60, 600):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।")
    name = body.username.strip()
    if check_credentials(name, body.password):
        return {"token": make_token(name, "admin"), "role": "admin"}
    shown = sharedlogin.verify(name, body.password)
    if shown:
        return {"token": make_token(shown, "user"), "role": "user"}
    time.sleep(0.6)  # slow down guessing
    raise HTTPException(status_code=401, detail="ID বা Password ভুল।")


@app.get("/api/me")
def me(who: dict = Depends(require_login)):
    out = {"user": who["u"], "role": who["r"]}
    if who["r"] == "admin":                  # only the admin sees set-up warnings
        warn = []
        if secret_is_default():
            warn.append("AUTH_SECRET সেট করা নেই।")
        if admin_uses_defaults():
            warn.append("ADMIN_USER / ADMIN_PASS env সেট করা নেই (built-in admin চলছে)।")
        if store.backend() is None:
            warn.append("Database (Upstash Redis) যুক্ত নেই: Global template edit ও Shared login সেটিং কাজ করবে না।")
        if sharedlogin.source() == "none":
            warn.append("Shared user login এখনো ঠিক করা হয়নি (Admin tab থেকে ঠিক করুন)।")
        out["warnings"] = warn
    return out


# ---------------------------------------------------------- admin: the ONE shared login
class SharedLoginIn(BaseModel):
    username: str
    password: str


def _write_limit(who: dict, request: Request):
    """Rate limit for every write: 40 per 10 minutes per admin + IP."""
    if not rate_limit("w:" + who["u"] + ":" + client_ip(request), 40, 600):
        raise HTTPException(status_code=429, detail="অনেক দ্রুত বদলানো হচ্ছে, একটু পরে চেষ্টা করুন।")


@app.get("/api/admin/shared-login")
def shared_login_info(who: dict = Depends(require_admin)):
    return sharedlogin.info()


@app.put("/api/admin/shared-login")
def shared_login_set(body: SharedLoginIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    try:
        sharedlogin.set_credentials(body.username, body.password, admin_name())
    except sharedlogin.LoginSettingError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, **sharedlogin.info()}


# ---------------------------------------------------------- policy (every number behind the rules; admin editable)
class PolicyIn(BaseModel):
    values: dict


class PolicyResetIn(BaseModel):
    keys: Optional[List[str]] = None      # None = reset everything


@app.get("/api/policy")
def policy_get(who: dict = Depends(require_login)):
    """Any logged-in user gets the current values (the Statement Checker and the MRP box use them);
    the admin also gets the field list, defaults and the change log."""
    return policy.info(admin=who["r"] == "admin")


@app.put("/api/admin/policy")
def policy_set(body: PolicyIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    try:
        diff = policy.save(body.values, admin_name())
    except policy.PolicyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except store.StoreUnavailable:
        raise HTTPException(status_code=503, detail="Database-এ সংযোগ করা যাচ্ছে না।")
    return {"ok": True, "changed": diff, **policy.info(admin=True)}


@app.post("/api/admin/policy/reset")
def policy_reset(body: PolicyResetIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    try:
        diff = policy.reset(body.keys, admin_name())
    except policy.PolicyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except store.StoreUnavailable:
        raise HTTPException(status_code=503, detail="Database-এ সংযোগ করা যাচ্ছে না।")
    return {"ok": True, "changed": diff, **policy.info(admin=True)}


# ---------------------------------------------------------- templates
@app.get("/api/templates")
def templates(who: dict = Depends(require_login)):
    """BP message library (global layer applied) - only for logged-in users. Admin also gets hidden items."""
    out = ts.catalog(include_hidden=who["r"] == "admin")
    out["api_version"] = 2
    out["role"] = who["r"]
    out["can_edit_global"] = who["r"] == "admin"
    return out


class TextIn(BaseModel):
    text: str


class NewTemplateIn(BaseModel):
    section: str
    text: str


class HiddenIn(BaseModel):
    hidden: bool


def _tpl_call(fn, *args):
    try:
        return fn(*args)
    except ts.TemplateError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except store.StoreUnavailable:
        raise HTTPException(status_code=502, detail="Database যুক্ত নেই বা যোগাযোগ করা যাচ্ছে না।")


@app.put("/api/templates/{tid}")
def template_edit(tid: str, body: TextIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    _tpl_call(ts.set_text, tid, body.text, who["u"])
    return {"ok": True}


@app.post("/api/templates")
def template_new(body: NewTemplateIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    return {"ok": True, "id": _tpl_call(ts.create_custom, body.section, body.text, who["u"])}


@app.post("/api/templates/{tid}/hidden")
def template_hide(tid: str, body: HiddenIn, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    _tpl_call(ts.set_hidden, tid, body.hidden, who["u"])
    return {"ok": True}


@app.post("/api/templates/{tid}/reset")
def template_reset(tid: str, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    _tpl_call(ts.reset_builtin, tid)
    return {"ok": True}


@app.delete("/api/templates/{tid}")
def template_delete(tid: str, request: Request, who: dict = Depends(require_admin)):
    _write_limit(who, request)
    _tpl_call(ts.delete_custom, tid)
    return {"ok": True}


# ---------------------------------------------------------- suggestion box
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.post("/api/feedback")
def feedback(body: FeedbackIn, request: Request, user: dict = Depends(require_login)):
    """Suggestion box. The recipient is read from the server environment and is never sent to the browser.
    Env (Vercel):  SMTP_USER (Gmail address), SMTP_PASS (Gmail *App Password*), FEEDBACK_TO (optional, default SMTP_USER)
    """
    if body.website:                      # bot
        return {"ok": True}
    email, msg = body.email.strip(), body.message.strip()
    if not _EMAIL_RE.match(email) or len(email) > 120:
        raise HTTPException(status_code=400, detail="সঠিক email দিন।")
    if len(msg) < 5:
        raise HTTPException(status_code=400, detail="মেসেজটা একটু বড় করে লিখুন।")
    if len(msg) > 2000:
        raise HTTPException(status_code=400, detail="মেসেজ ২০০০ অক্ষরের বেশি হতে পারবে না।")
    if not rate_limit("fb:" + client_ip(request), 5, 3600):
        raise HTTPException(status_code=429, detail="অনেকবার পাঠানো হয়েছে, পরে চেষ্টা করুন।")

    smtp_user, smtp_pass = os.getenv("SMTP_USER"), os.getenv("SMTP_PASS")
    if not smtp_user or not smtp_pass:
        raise HTTPException(status_code=503, detail="Mail সার্ভিস এখনো চালু করা হয়নি।")
    mail = EmailMessage()
    mail["Subject"] = f"TopPay suggestion from {email}"[:150]
    mail["From"] = smtp_user
    mail["To"] = os.getenv("FEEDBACK_TO") or smtp_user
    mail["Reply-To"] = email
    mail.set_content(f"From: {email}\n\n{msg}")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=15) as s:
            s.login(smtp_user, smtp_pass)
            s.send_message(mail)
    except Exception:
        raise HTTPException(status_code=502, detail="Mail পাঠানো যায়নি, একটু পরে আবার চেষ্টা করুন।")
    return {"ok": True}


# ---------------------------------------------------------- the decision
@app.post("/api/check")
def check(body: CheckIn, user: dict = Depends(require_login)):
    """Manual form: no AI, no API key, no cost - pure rule engine. Nothing from the request is stored or logged."""
    out = build_case(body.data, [m.model_dump() for m in body.manual], body.dismissed)
    out["data"] = {k: body.data.get(k) for k in FIELDS}
    return out


@app.post("/api/analyze")
def analyze(body: AnalyzeIn, x_app_pin: Optional[str] = Header(default=None), user: dict = Depends(require_login)):
    """AI text box (currently switched off in the UI). Needs: pip install google-genai openai"""
    from llm_parser import merge, parse_with_llm  # lazy import: not needed for the manual form

    _check_pin(x_app_pin)
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="কোনো তথ্য লেখা হয়নি।")

    provider = os.getenv("LLM_PROVIDER", "Gemini")
    key_env = "GEMINI_API_KEY" if provider == "Gemini" else "OPENAI_API_KEY"
    api_key = os.getenv(key_env)
    if not api_key:
        raise HTTPException(status_code=500, detail=f"Server-এ {key_env} সেট করা নেই।")
    model = os.getenv("LLM_MODEL", "gemini-3.8-flash" if provider == "Gemini" else "gpt-4o-mini")

    previous = {k: body.data.get(k) for k in FIELDS}
    try:
        parsed = parse_with_llm(text, previous, provider, api_key, model)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI parser error: {e}")

    merged = merge(previous, parsed)
    out = build_case(merged)
    out["data"] = merged
    return out


# Local development only (on Vercel the CDN serves /public).
if not os.getenv("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    _public = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    if os.path.isdir(_public):
        app.mount("/", StaticFiles(directory=_public, html=True), name="static")
