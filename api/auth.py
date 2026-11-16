"""Login for the TopPay tool: exactly two roles.
  admin  - env ADMIN_USER / ADMIN_PASS (or the built-in fallback account below until you set them)
  user   - ONE shared login (see sharedlogin.py)

* Login tokens are signed, expiring strings (stateless -> works on Vercel serverless). A token carries a fingerprint of the
  credentials it was issued for; change the password and every old token dies (shared user: within ~20 s).
* Env AUTH_SECRET signs the tokens - always set it on Vercel.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request

import sharedlogin
import store

DEFAULT_USER = "Toppay_admin"
_SALT = "e2ee37845c3840cb0037e93e5c40d441"
_HASH = "29ce3fcfbdf80d8aa47f2cf56dea373f6756b1d8d65ba01d6dc9cdf4bc5a1bc1"
_ITER = 200_000
TOKEN_TTL = 12 * 3600  # seconds


def secret_is_default() -> bool:
    return not os.getenv("AUTH_SECRET")


def _secret() -> bytes:
    return (os.getenv("AUTH_SECRET") or ("toppay-default-" + _HASH)).encode()


def admin_name() -> str:
    return os.getenv("ADMIN_USER") or DEFAULT_USER


def admin_uses_defaults() -> bool:
    return not (os.getenv("ADMIN_USER") and os.getenv("ADMIN_PASS"))


def admin_fp() -> str:
    pw = os.getenv("ADMIN_PASS") or _HASH
    return "a" + hashlib.sha256((admin_name() + "\n" + pw).encode() + _secret()).hexdigest()[:12]


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


def make_token(user: str, role: str = "user") -> str:
    fp = admin_fp() if role == "admin" else sharedlogin.fingerprint()
    payload = _b64(json.dumps({"u": user, "r": role, "v": fp, "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(token: str) -> Optional[dict]:
    """Signature + expiry + 'is this still the current password?' -> {"u", "r"} or None."""
    try:
        payload, sig = token.split(".", 1)
        good = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(_unb64(payload))
        if data["exp"] <= time.time():
            return None
        role = data.get("r", "user")
        current = admin_fp() if role == "admin" else sharedlogin.fingerprint()
        if data.get("v") != current:
            return None
        return {"u": data["u"], "r": role}
    except Exception:
        return None


def require_login(authorization: Optional[str] = Header(default=None)) -> dict:
    """FastAPI dependency: 401 unless a valid 'Authorization: Bearer <token>' is sent. Returns {"u", "r"}."""
    if authorization and authorization.lower().startswith("bearer "):
        who = verify_token(authorization[7:].strip())
        if who:
            return who
    raise HTTPException(status_code=401, detail="Login করুন।")


def require_admin(who: dict = Depends(require_login)) -> dict:
    if who["r"] != "admin":
        raise HTTPException(status_code=403, detail="শুধু admin এটা করতে পারবে।")
    return who


# ---- rate limiting: shared through the database when there is one (so it survives serverless restarts),
#      otherwise a small in-memory counter.
_hits: dict = {}


def _mem_limit(key, limit, window):
    now = time.time()
    arr = [t for t in _hits.get(key, []) if now - t < window]
    if len(arr) >= limit:
        _hits[key] = arr
        return False
    arr.append(now)
    _hits[key] = arr
    return True


def rate_limit(key: str, limit: int, window: int) -> bool:
    """True if allowed. At most `limit` calls per `window` seconds for this key."""
    if store.backend() == "redis":
        try:
            return store.incr_window("rl:" + key, window) <= limit
        except store.StoreUnavailable:
            pass
    return _mem_limit(key, limit, window)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")
