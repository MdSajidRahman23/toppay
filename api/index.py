"""FastAPI backend for TopPay Smart Decision Assistant (Vercel-ready).
Local:   uvicorn api.index:app --reload     -> http://127.0.0.1:8000
Vercel:  routed through vercel.json; static files are served from /public.
"""
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import re  # noqa: E402
import smtplib  # noqa: E402
import time  # noqa: E402
from email.message import EmailMessage  # noqa: E402

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from auth import (  # noqa: E402
    check_credentials, client_ip, make_token, rate_limit, require_login, verify_token,
)
from rules_engine import FIELDS, evaluate_application  # noqa: E402
from templates_data import TEMPLATES  # noqa: E402

app = FastAPI(title="TopPay Smart Decision Assistant")


def _check_pin(pin: Optional[str]):
    """Optional access PIN: set APP_PIN env var to protect your AI quota."""
    need = os.getenv("APP_PIN")
    if need and pin != need:
        raise HTTPException(status_code=401, detail="PIN ভুল বা দেওয়া হয়নি।")


class AnalyzeIn(BaseModel):
    text: str
    data: dict = {}


class CheckIn(BaseModel):
    data: dict


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
    if not rate_limit("login:" + ip, 8, 600):
        raise HTTPException(status_code=429, detail="অনেকবার ভুল চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।")
    if not check_credentials(body.username.strip(), body.password):
        time.sleep(0.6)  # slow down guessing
        raise HTTPException(status_code=401, detail="ID বা Password ভুল।")
    return {"token": make_token(body.username.strip())}


@app.get("/api/me")
def me(user: str = Depends(require_login)):
    return {"user": user}


@app.get("/api/templates")
def templates(user: str = Depends(require_login)):
    """BP message library - only for logged-in users."""
    return TEMPLATES


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.post("/api/feedback")
def feedback(body: FeedbackIn, request: Request, user: str = Depends(require_login)):
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


@app.post("/api/analyze")
def analyze(body: AnalyzeIn, x_app_pin: Optional[str] = Header(default=None), user: str = Depends(require_login)):
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
    return {"data": merged, "result": evaluate_application(merged)}


@app.post("/api/check")
def check(body: CheckIn, user: str = Depends(require_login)):
    """Manual form: no AI, no API key, no cost - pure rule engine."""
    data = {k: body.data.get(k) for k in FIELDS}
    return {"data": data, "result": evaluate_application(data)}


# Local development only (on Vercel the CDN serves /public).
if not os.getenv("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    _public = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    if os.path.isdir(_public):
        app.mount("/", StaticFiles(directory=_public, html=True), name="static")
