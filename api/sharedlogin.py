"""The ONE shared login for all reviewers (role "user"). The admin account lives in auth.py (env ADMIN_USER / ADMIN_PASS).

Where the shared ID + password come from:
  1. the record the admin saved in the admin panel (database key "toppay:shared_user", password stored as a salted PBKDF2 hash)
  2. otherwise the environment variables USER_ID and USER_PASS
  3. otherwise nobody can log in as a user yet (the admin still can)

Every login token carries a "fingerprint" of the current shared credentials. When the admin changes the ID or the password
the fingerprint changes, and all old tokens stop working within ~20 seconds (that is how everybody is logged out).
Honest limit of ONE shared login: the system cannot tell WHO did what (no per-person audit), and one leaked password
exposes everybody until the admin changes it.
"""
import hashlib
import hmac
import json
import os
import re
import time
from typing import Optional

import store

KEY = "toppay:shared_user"
_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
_ITER = 200_000
_cache = {"t": 0.0, "rec": None, "fp": None}
CACHE_TTL = 20


class LoginSettingError(Exception):
    """A problem the admin should see (bad ID, short password, database missing...)."""


def _hash(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _ITER).hex()


def _stored() -> Optional[dict]:
    try:
        raw = store.get(KEY) if store.backend() else None
    except store.StoreUnavailable:
        raise
    return json.loads(raw) if raw else None


def _env():
    u, p = os.getenv("USER_ID"), os.getenv("USER_PASS")
    return (u, p) if u and p else None


def _load(force=False):
    now = time.time()
    if not force and now - _cache["t"] < CACHE_TTL and _cache["fp"] is not None:
        return _cache["rec"], _cache["fp"]
    try:
        rec = _stored()
    except store.StoreUnavailable:
        if _cache["fp"] is not None:
            return _cache["rec"], _cache["fp"]      # keep the last known value
        rec = None
    if rec:
        fp = "s" + rec["hash"][:12] + str(rec.get("ver", 0))
    elif _env():
        u, p = _env()
        fp = "e" + hashlib.sha256(f"{u}\n{p}".encode()).hexdigest()[:12]
    else:
        fp = "none"
    _cache.update(t=now, rec=rec, fp=fp)
    return rec, fp


def fingerprint() -> str:
    return _load()[1]


def source() -> str:
    rec, _ = _load()
    return "panel" if rec else ("env" if _env() else "none")


def display_name() -> Optional[str]:
    rec, _ = _load()
    if rec:
        return rec["display"]
    return _env()[0] if _env() else None


def info() -> dict:
    rec, _ = _load(force=True)
    return {"source": source(), "display": display_name(), "updated": rec.get("updated") if rec else None,
            "storage": store.backend()}


def verify(name: str, password: str) -> Optional[str]:
    """Return the shown user name when the shared login is right, else None (never raises)."""
    name = (name or "").strip()
    rec, _ = _load()
    if rec:
        good_user = hmac.compare_digest(name.lower().encode(), rec["display"].lower().encode())
        good_pass = hmac.compare_digest(_hash(password, rec["salt"]), rec["hash"])
        return rec["display"] if (good_user and good_pass) else None
    env = _env()
    if env:
        good_user = hmac.compare_digest(name.lower().encode(), env[0].lower().encode())
        good_pass = hmac.compare_digest(password.encode(), env[1].encode())
        return env[0] if (good_user and good_pass) else None
    _hash(password, "00" * 16)       # similar timing when nothing is configured
    return None


def set_credentials(name: str, password: str, admin_user: str):
    name = (name or "").strip()
    if not _NAME_RE.match(name):
        raise LoginSettingError("ID শুধু ইংরেজি অক্ষর, সংখ্যা, _ . - দিয়ে (৩-৩০ অক্ষর) হতে পারবে।")
    if name.lower() == (admin_user or "").lower():
        raise LoginSettingError("Admin-এর ID এখানে ব্যবহার করা যাবে না।")
    if not 6 <= len(password or "") <= 60:
        raise LoginSettingError("Password ৬ থেকে ৬০ অক্ষরের মধ্যে হতে হবে।")
    if store.backend() is None:
        raise LoginSettingError("Database যুক্ত নেই (Vercel → Storage → Upstash Redis)। আপাতত Vercel env USER_ID / USER_PASS ব্যবহার করুন।")
    try:
        old = _stored()
    except store.StoreUnavailable:
        raise LoginSettingError("Database-এর সাথে যোগাযোগ করা যাচ্ছে না।")
    salt = os.urandom(16).hex()
    rec = {"display": name, "salt": salt, "hash": _hash(password, salt),
           "ver": int((old or {}).get("ver", 0)) + 1, "updated": int(time.time())}
    try:
        store.set(KEY, json.dumps(rec))
    except store.StoreUnavailable:
        raise LoginSettingError("Database-এর সাথে যোগাযোগ করা যাচ্ছে না।")
    _load(force=True)
