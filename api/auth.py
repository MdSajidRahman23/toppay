"""Login for the TopPay tool (single shared admin account, no database).

* The password is NOT stored in plain text: only a salted PBKDF2 hash is kept below.
* To change the login without editing code, set these Vercel environment variables:
    ADMIN_USER, ADMIN_PASS   (plain text, overrides the built-in account)
    AUTH_SECRET              (any long random string - signs the login tokens; please set it)
* A login token is a signed, expiring string (stateless, so it works on Vercel serverless).
"""
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import Header, HTTPException, Request

DEFAULT_USER = "Toppay_admin"
_SALT = "e2ee37845c3840cb0037e93e5c40d441"
_HASH = "29ce3fcfbdf80d8aa47f2cf56dea373f6756b1d8d65ba01d6dc9cdf4bc5a1bc1"
_ITER = 200_000
TOKEN_TTL = 12 * 3600  # seconds


def _secret() -> bytes:
    return (os.getenv("AUTH_SECRET") or ("toppay-default-" + _HASH)).encode()


def check_credentials(user: str, password: str) -> bool:
    env_user, env_pass = os.getenv("ADMIN_USER"), os.getenv("ADMIN_PASS")
    if env_user and env_pass:
        ok_user = hmac.compare_digest(user.encode(), env_user.encode())
        ok_pass = hmac.compare_digest(password.encode(), env_pass.encode())
        return ok_user and ok_pass
    got = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(_SALT), _ITER).hex()
    ok_user = hmac.compare_digest(user.encode(), DEFAULT_USER.encode())
    ok_pass = hmac.compare_digest(got, _HASH)
    return ok_user and ok_pass


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(user: str) -> str:
    payload = _b64(json.dumps({"u": user, "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(token: str) -> Optional[str]:
    try:
        payload, sig = token.split(".", 1)
        good = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(_unb64(payload))
        return data["u"] if data["exp"] > time.time() else None
    except Exception:
        return None


def require_login(authorization: Optional[str] = Header(default=None)) -> str:
    """FastAPI dependency: 401 unless a valid 'Authorization: Bearer <token>' is sent."""
    if authorization and authorization.lower().startswith("bearer "):
        user = verify_token(authorization[7:].strip())
        if user:
            return user
    raise HTTPException(status_code=401, detail="Login করুন।")


# ---- tiny in-memory rate limiter (best effort: resets when the serverless instance restarts)
_hits: dict = {}


def rate_limit(key: str, limit: int, window: int) -> bool:
    """True if allowed. At most `limit` calls per `window` seconds for this key."""
    now = time.time()
    arr = [t for t in _hits.get(key, []) if now - t < window]
    if len(arr) >= limit:
        _hits[key] = arr
        return False
    arr.append(now)
    _hits[key] = arr
    return True


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")
