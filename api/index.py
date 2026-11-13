"""FastAPI backend for TopPay Smart Decision Assistant (Vercel-ready).
Local:   uvicorn api.index:app --reload     -> http://127.0.0.1:8000
Vercel:  routed through vercel.json; static files are served from /public.
"""
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from rules_engine import FIELDS, evaluate_application  # noqa: E402

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


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/analyze")
def analyze(body: AnalyzeIn, x_app_pin: Optional[str] = Header(default=None)):
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
def check(body: CheckIn):
    """Manual form: no AI, no API key, no cost - pure rule engine."""
    data = {k: body.data.get(k) for k in FIELDS}
    return {"data": data, "result": evaluate_application(data)}


# Local development only (on Vercel the CDN serves /public).
if not os.getenv("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    _public = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    if os.path.isdir(_public):
        app.mount("/", StaticFiles(directory=_public, html=True), name="static")
