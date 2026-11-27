importScripts("alert-bg.js"); // TopPay Audit Alert (beep on new Pending cases)
// Service worker v3.9: non-blocking local rules/templates/OCR caching + timeout-safe background sync.
// Sends numbers / flags / template ids only - never a name, phone, NID number, address or photo.
const DEFAULT_BASE = "https://toppay-zeta.vercel.app";
const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7500;
const OCR_CACHE_MAX = 150;

// Only plain https to public hosts - never localhost / private networks / odd schemes.
function isSafeFetchUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:") return false;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [p, q] = h.split(".").map(Number);
      if (p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 192 && q === 168) || (p === 172 && q >= 16 && q <= 31)) return false;
    }
    if (h.includes(":")) return false; // IPv6 literal
    return true;
  } catch (e) { return false; }
}

async function getCfg() {
  const o = await chrome.storage.local.get(["tp_token", "tp_base"]);
  return { token: o.tp_token || "", base: (o.tp_base || DEFAULT_BASE).replace(/\/+$/, "") };
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function call(m) {
  const c = await getCfg();
  const headers = { "Content-Type": "application/json" };
  if (m.auth !== false) {
    if (!c.token) return { ok: false, status: 401, error: "Login required" };
    headers["Authorization"] = "Bearer " + c.token;
  }
  let res;
  try {
    res = await fetchWithTimeout(c.base + m.path, {
      method: m.method || "GET",
      headers,
      body: m.body ? JSON.stringify(m.body) : undefined,
    }, m.timeout || FETCH_TIMEOUT_MS);
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "Server timeout" : "Network error: " + (e && e.message ? e.message : e);
    return { ok: false, status: 0, error: msg };
  }
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (res.status === 401 && m.auth !== false) {
    await chrome.storage.local.remove(["tp_token", "tp_policy_cache", "tp_templates_cache"]);
  }
  return { ok: res.ok, status: res.status, json, error: res.ok ? null : (json && typeof json.detail === "string" ? json.detail : "Error " + res.status) };
}

async function refreshRulesBundle() {
  const [rp, rt] = await Promise.all([
    call({ path: "/api/policy" }),
    call({ path: "/api/templates" }),
  ]);
  const patch = {};
  const now = Date.now();
  if (rp.ok && rp.json && rp.json.values) {
    patch.tp_policy_cache = { values: rp.json.values, ts: now };
  }
  if (rt.ok && rt.json && rt.json.sections) {
    patch.tp_templates_cache = { catalog: rt.json, ts: now };
  }
  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }
  return {
    ok: rp.ok || rt.ok,
    status: rp.status === 401 || rt.status === 401 ? 401 : (rp.ok ? rp.status : rt.status),
    policy: patch.tp_policy_cache ? patch.tp_policy_cache.values : null,
    templates: patch.tp_templates_cache ? patch.tp_templates_cache.catalog : null,
  };
}

function normalizeOcrKey(url) {
  return String(url || "").split("?")[0].split("#")[0].slice(-180);
}

chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m && typeof m.type === "string" && m.type.indexOf("tp-alert") === 0) return false; // handled by alert-bg.js
  if (m && m.target === "offscreen") return false;
  (async () => {
    if (!m || !m.type) { send({ ok: false, error: "bad message" }); return; }
    if (m.type === "cfg") {
      const c = await getCfg();
      send({ ok: true, base: c.base, loggedIn: !!c.token });
      return;
    }
    if (m.type === "setBase") {
      await chrome.storage.local.set({ tp_base: String(m.base || "").trim() });
      await chrome.storage.local.remove(["tp_policy_cache", "tp_templates_cache"]);
      send({ ok: true });
      return;
    }
    if (m.type === "logout") {
      await chrome.storage.local.remove(["tp_token", "tp_policy_cache", "tp_templates_cache"]);
      send({ ok: true });
      return;
    }
    if (m.type === "login") {
      const r = await call({ path: "/api/login", method: "POST", auth: false, body: { username: m.username, password: m.password }, timeout: 12000 });
      if (r.ok && r.json && r.json.token) {
        await chrome.storage.local.set({ tp_token: r.json.token });
        refreshRulesBundle().catch(() => {});
      }
      send({ ok: r.ok, error: r.error });
      return;
    }
    if (m.type === "rulesBundle") {
      const o = await chrome.storage.local.get(["tp_policy_cache", "tp_templates_cache"]);
      const pc = o.tp_policy_cache;
      const tc = o.tp_templates_cache;
      if (!m.force && (pc || tc)) {
        send({
          ok: true,
          cached: true,
          policy: pc ? pc.values : null,
          templates: tc ? tc.catalog : null,
        });
        const stale = !pc || !tc || (Date.now() - Math.min(pc.ts || 0, tc.ts || 0) > CACHE_TTL_MS);
        if (stale) refreshRulesBundle().catch(() => {});
        return;
      }
      send(await refreshRulesBundle());
      return;
    }
    if (m.type === "ocrCacheGet") {
      const key = normalizeOcrKey(m.url);
      if (!key) { send({ hit: false }); return; }
      const o = await chrome.storage.local.get(["tp_ocr_cache"]);
      const map = o.tp_ocr_cache || {};
      const entry = map[key];
      send(entry && entry.v === "3.18.2" && Array.isArray(entry.texts) ? { hit: true, texts: entry.texts, qrCodes: entry.qrCodes || [], forensics: entry.forensics || null } : { hit: false });
      return;
    }
    if (m.type === "ocrCacheSet") {
      const key = normalizeOcrKey(m.url);
      if (!key || !Array.isArray(m.texts) || !m.texts.length) { send({ ok: false }); return; }
      const o = await chrome.storage.local.get(["tp_ocr_cache"]);
      const map = o.tp_ocr_cache || {};
      map[key] = { v: "3.18.2", texts: m.texts, qrCodes: m.qrCodes || [], forensics: m.forensics || null, ts: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > OCR_CACHE_MAX) {
        keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
        for (const k of keys.slice(0, keys.length - OCR_CACHE_MAX)) delete map[k];
      }
      await chrome.storage.local.set({ tp_ocr_cache: map });
      send({ ok: true });
      return;
    }
    if (m.type === "fetchDataUrl") {
      try {
        if (!isSafeFetchUrl(m.url)) { send({ ok: false, error: "blocked url" }); return; }
        const res = await fetchWithTimeout(m.url, { credentials: "omit" }, m.timeout || 12000);
        if (!res.ok) { send({ ok: false, error: "HTTP " + res.status }); return; }
        const ct = res.headers.get("content-type") || "application/octet-stream";
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        send({ ok: true, contentType: ct, dataUrl: "data:" + ct + ";base64," + btoa(bin) });
      } catch (e) {
        send({ ok: false, error: String((e && e.message) || e) });
      }
      return;
    }
    if (m.type === "api") {
      send(await call(m));
      return;
    }
    send({ ok: false, error: "unknown message" });
  })();
  return true;
});
