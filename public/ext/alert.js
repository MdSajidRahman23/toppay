// TopPay Audit Alert module (merged from toppay-alert v2.1).
// Beeps when new "Pending Check / Pending Review" cases appear on the audit LIST page.
// Does nothing on a case detail page, so it never fights with the Smart Decision scan.
(() => {
  "use strict";
  if (window.__tpAlertLoaded) return;
  window.__tpAlertLoaded = true;

  let settings = { enabled: false, duration: 30, refresh: 0 };
  let banner = null, bannerTimer = null;
  let lastTotal = null, lastRefresh = Date.now();
  let checkQueued = false;

  const onDetail = () => /\/detail\/[a-zA-Z0-9_-]+/i.test(location.pathname + " " + location.hash);

  function loadSettings() {
    chrome.storage.sync.get({ enabled: false, duration: 30, refresh: 0 }, (s) => {
      settings = s;
      if (!s.enabled) stopAlarm();
    });
  }
  loadSettings();

  // ---- visible on-page toggle chip (bottom-left) so the alert is easy to find ----
  let chip = null;
  function renderChip() {
    if (!document.body) return;
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "tp-alert-chip";
      chip.style.cssText =
        "position:fixed;left:16px;bottom:24px;z-index:2147483646;padding:8px 12px;border-radius:10px;" +
        "font:600 12px sans-serif;color:#fff;cursor:pointer;user-select:none;box-shadow:0 4px 14px rgba(0,0,0,.45);" +
        "border:1px solid rgba(255,255,255,.25)";
      chip.title = "Click: alert ON/OFF. Beep time & auto-refresh: toolbar icon";
      chip.onclick = () => chrome.storage.sync.set({ enabled: !settings.enabled });
      document.body.appendChild(chip);
    }
    chip.style.display = onDetail() ? "none" : "block";
    chip.style.background = settings.enabled ? "#16a34a" : "#475569";
    chip.textContent = settings.enabled
      ? "🔔 Alert ON" + (settings.refresh ? " · refresh " + settings.refresh + "s" : "")
      : "🔕 Alert OFF";
  }
  setInterval(renderChip, 500);
  chrome.storage.onChanged.addListener((_c, area) => { if (area === "sync") loadSettings(); });

  function send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) { /* extension reloaded */ }
  }

  function showBanner(seconds) {
    if (banner) banner.remove();
    clearTimeout(bannerTimer);
    banner = document.createElement("div");
    banner.textContent = "🔔 New data! Click to stop";
    banner.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#e53935;color:#fff;padding:10px 18px;border-radius:8px;font:600 14px sans-serif;" +
      "cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)";
    banner.onclick = stopAlarm;
    document.body.appendChild(banner);
    bannerTimer = setTimeout(hideBanner, seconds * 1000);
  }
  function hideBanner() {
    clearTimeout(bannerTimer);
    if (banner) { banner.remove(); banner = null; }
  }
  function startAlarm(seconds) { showBanner(seconds); send({ type: "tp-alert-start", seconds }); }
  function stopAlarm() { hideBanner(); send({ type: "tp-alert-stop" }); }

  function readCounts() {
    const out = { check: 0, review: 0, found: false };
    document.querySelectorAll("label.el-radio-button").forEach((l) => {
      const t = l.textContent.replace(/\s+/g, " ").trim();
      const m = t.match(/^(Pending Check|Pending Review)\s*\((\d+)\)/);
      if (m) {
        out.found = true;
        out[m[1] === "Pending Check" ? "check" : "review"] = parseInt(m[2], 10);
      } else if (/^Pending (Check|Review)/.test(t)) out.found = true;
    });
    return out;
  }

  // Which tab is active? Returns "pending" / "other" / null (unknown -> trust counts only)
  function activeTab() {
    const act = document.querySelector("label.el-radio-button.is-active");
    if (!act) return null;
    return /^\s*Pending (Check|Review)/.test(act.textContent) ? "pending" : "other";
  }

  // Stable key per case card: ID + masked phone
  function readCardKeys() {
    const keys = new Set();
    document.querySelectorAll(".audit-card").forEach((c) => {
      const txt = c.textContent;
      const id = txt.match(/ID:\s*(\d+)/);
      const ph = txt.match(/\d{3}\*{4}\d{4}|\b\d{11}\b/);
      if (id || ph) keys.add((id ? id[1] : "") + "|" + (ph ? ph[0] : ""));
    });
    return keys;
  }

  // Seen cases are remembered (12h) so a page reload does not re-beep for the same cases.
  const SEEN_KEY = "tp_alert_seen", SEEN_TTL = 12 * 3600 * 1000;
  let seen = null; // {key: ts}, null until loaded
  chrome.storage.local.get(SEEN_KEY, (o) => { seen = o[SEEN_KEY] || {}; });
  function saveSeen() {
    const now = Date.now();
    Object.keys(seen).forEach((k) => { if (now - seen[k] > SEEN_TTL) delete seen[k]; });
    const ks = Object.keys(seen);
    if (ks.length > 500) ks.sort((x, y) => seen[x] - seen[y]).slice(0, ks.length - 500).forEach((k) => delete seen[k]);
    chrome.storage.local.set({ [SEEN_KEY]: seen });
  }

  function maybeRefresh() {
    if (!settings.enabled || !settings.refresh || onDetail()) return;
    if (Date.now() - lastRefresh < settings.refresh * 1000 - 2000) return;
    lastRefresh = Date.now();
    const btn = [...document.querySelectorAll("button")].find((b) => /^\s*Search\s*$/.test(b.textContent));
    if (btn) btn.click();
  }

  function check() {
    if (!settings.enabled || onDetail() || seen === null) return;
    const c = readCounts();
    const tab = activeTab();
    let isNew = false;

    // 1) A card we have not seen before, only while a Pending tab is showing (never on Approved/All...)
    if (tab === "pending" || (tab === null && !c.found)) {
      const now = Date.now(); let changed = false;
      readCardKeys().forEach((k) => {
        if (!seen[k]) { isNew = true; changed = true; }
        seen[k] = now;
      });
      if (changed) saveSeen();
    }
    // 2) Count tabs: total went up (works even if the card layout changes)
    if (c.found) {
      const total = c.check + c.review;
      if (lastTotal !== null && total > lastTotal) isNew = true;
      lastTotal = total;
    }
    if (isNew) startAlarm(settings.duration);
  }

  setInterval(() => { maybeRefresh(); check(); }, 1000);
  // DOM change -> check soon, but debounced so heavy detail pages are not slowed down
  new MutationObserver(() => {
    if (checkQueued) return;
    checkQueued = true;
    setTimeout(() => { checkQueued = false; check(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "tp-alert-tick") { maybeRefresh(); check(); }
  });
})();
