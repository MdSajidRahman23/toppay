"""Tiny key-value store used for templates (global layer), shared login and shared rate limits.

Backends (checked in this order):
  1. Upstash Redis REST - env UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN   (use this on Vercel)
  2. a local JSON file (default .data.json in the project folder, or env TOPPAY_DATA_FILE) - only when NOT on Vercel
No backend (Vercel without Redis) -> backend() is None and writes raise StoreUnavailable.
Only small settings are stored here. NEVER customer data.
"""
import json
import os
import threading
import time
import urllib.request
from typing import Optional

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_lock = threading.Lock()


class StoreUnavailable(Exception):
    """No database is connected (or it cannot be reached)."""


def _redis_conf():
    url = os.getenv("UPSTASH_REDIS_REST_URL") or os.getenv("KV_REST_API_URL")
    tok = os.getenv("UPSTASH_REDIS_REST_TOKEN") or os.getenv("KV_REST_API_TOKEN")
    return (url.rstrip("/"), tok) if url and tok else None


def backend() -> Optional[str]:
    if _redis_conf():
        return "redis"
    if not os.getenv("VERCEL"):
        return "file"
    return None


def _redis(*cmd):
    url, tok = _redis_conf()
    req = urllib.request.Request(
        url, data=json.dumps([str(c) for c in cmd]).encode(),
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            out = json.loads(r.read())
    except Exception as e:  # network / DNS / timeout
        raise StoreUnavailable(str(e))
    if out.get("error"):
        raise StoreUnavailable(out["error"])
    return out.get("result")


# ------------------------------------------------------------------ file backend
def _path():
    return os.getenv("TOPPAY_DATA_FILE") or os.path.join(_ROOT, ".data.json")


def _load():
    try:
        with open(_path(), encoding="utf-8") as f:
            d = json.load(f)
    except (FileNotFoundError, ValueError):
        d = {}
    d.setdefault("kv", {}); d.setdefault("h", {}); d.setdefault("ttl", {})
    now = time.time()
    for k in [k for k, t in d["ttl"].items() if t < now]:
        d["ttl"].pop(k, None); d["kv"].pop(k, None)
    return d


def _save(d):
    with open(_path(), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


def _need():
    b = backend()
    if b is None:
        raise StoreUnavailable("Database যুক্ত করা হয়নি")
    return b


# ------------------------------------------------------------------ public API
def get(key: str) -> Optional[str]:
    if _need() == "redis":
        return _redis("GET", key)
    with _lock:
        return _load()["kv"].get(key)


def set(key: str, value: str):
    if _need() == "redis":
        _redis("SET", key, value)
        return
    with _lock:
        d = _load(); d["kv"][key] = value; _save(d)


def delete(key: str):
    if _need() == "redis":
        _redis("DEL", key)
        return
    with _lock:
        d = _load(); d["kv"].pop(key, None); d["h"].pop(key, None); _save(d)


def hgetall(key: str) -> dict:
    if _need() == "redis":
        flat = _redis("HGETALL", key) or []
        return {flat[i]: flat[i + 1] for i in range(0, len(flat), 2)}
    with _lock:
        return dict(_load()["h"].get(key, {}))


def hset(key: str, field: str, value: str):
    if _need() == "redis":
        _redis("HSET", key, field, value)
        return
    with _lock:
        d = _load(); d["h"].setdefault(key, {})[field] = value; _save(d)


def hdel(key: str, field: str):
    if _need() == "redis":
        _redis("HDEL", key, field)
        return
    with _lock:
        d = _load(); d["h"].get(key, {}).pop(field, None); _save(d)


def incr_window(key: str, window: int) -> int:
    """Increase a counter that disappears after `window` seconds; returns the new value."""
    if _need() == "redis":
        n = int(_redis("INCR", key))
        if n == 1:
            _redis("EXPIRE", key, window)
        return n
    with _lock:
        d = _load()
        n = int(d["kv"].get(key, 0)) + 1
        d["kv"][key] = str(n)
        if n == 1:
            d["ttl"][key] = time.time() + window
        _save(d)
        return n


def incr(key: str) -> int:
    if _need() == "redis":
        return int(_redis("INCR", key))
    with _lock:
        d = _load(); n = int(d["kv"].get(key, 0)) + 1; d["kv"][key] = str(n); _save(d); return n
