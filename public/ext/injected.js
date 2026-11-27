// TopPay Network & Attachment Interceptor v3.9.5 (MAIN World)
// Captures API JSON payloads (order fields, phones, NID URLs, PDFs) & Salary Slip links instantaneously,
// and buffers early events so content.js never misses responses that arrived before document_idle.
(function () {
  "use strict";
  if (window.__toppayMainV39) return;
  window.__toppayMainV39 = true;

  const eventBuffer = [];
  const MAX_BUFFER = 40;

  function post(kind, extra) {
    const msg = Object.assign({ source: "TOPPAY_MAIN_EVENT", kind }, extra || {});
    eventBuffer.push(msg);
    if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();
    try {
      window.postMessage(msg, "*");
    } catch { /* ignore */ }
  }

  function extractPdfHints(obj, path, found, depth) {
    if (!obj || depth > 6) return;
    if (typeof obj === "string") {
      const s = obj.trim();
      if (!s || !/^https?:\/\//i.test(s)) return;
      const combo = (path + " " + s).toLowerCase();
      // Skip non-statement PDFs (Electronic Contract, Consent Form, Work ID)
      if (/contract|consent|agreement|work.?id|login.?id|signature|onsite|face/i.test(combo)) return;
      if (/\.pdf(\?|$|#)/i.test(s) || /salary|slip|statement|bank|bkash|nagad|income|payslip/i.test(combo)) {
        found.push({ url: s, path });
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => extractPdfHints(v, path + "[" + i + "]", found, depth + 1));
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        extractPdfHints(v, path ? path + "." + k : k, found, depth + 1);
      }
    }
  }

  function collectScalarFields(obj, map, depth) {
    if (!obj || typeof obj !== "object" || depth > 5) return;
    if (Array.isArray(obj)) {
      obj.forEach((v) => collectScalarFields(v, map, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v).trim();
        if (s && !Object.prototype.hasOwnProperty.call(map, k)) {
          map[k] = s;
        }
      } else if (typeof v === "object") {
        collectScalarFields(v, map, depth + 1);
      }
    }
  }

  function inspectApiJson(url, json) {
    const pdfs = [];
    extractPdfHints(json, "", pdfs, 0);
    if (pdfs.length) post("api-pdfs", { url, pdfs });

    if (json && typeof json === "object") {
      const scalars = {};
      collectScalarFields(json, scalars, 0);
      if (Object.keys(scalars).length >= 3) {
        post("api-data", { url, scalars });
      }
    }
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function (...args) {
      const res = await origFetch.apply(this, args);
      try {
        const reqUrl = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || res.url || "";
        const ct = (res.headers && res.headers.get("content-type")) || "";
        if (ct.includes("application/pdf") || /\.pdf(\?|$|#)/i.test(res.url || reqUrl)) {
          post("pdf-url", { url: res.url || reqUrl, hint: "fetch-pdf", probing: !!window.__tpProbingSalarySlip });
        } else if (ct.includes("json")) {
          res.clone().json().then((j) => inspectApiJson(res.url || reqUrl, j)).catch(() => {});
        }
      } catch { /* ignore */ }
      return res;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tpUrl = String(url || "");
    return origOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const finalUrl = this.responseURL || this.__tpUrl || "";
        const ct = this.getResponseHeader("content-type") || "";
        if (ct.includes("application/pdf") || /\.pdf(\?|$|#)/i.test(finalUrl)) {
          post("pdf-url", { url: finalUrl, hint: "xhr-pdf", probing: !!window.__tpProbingSalarySlip });
        } else if (ct.includes("json") && typeof this.responseText === "string" && this.responseText.length < 1500000) {
          const j = JSON.parse(this.responseText);
          inspectApiJson(finalUrl, j);
        }
      } catch { /* ignore */ }
    });
    return origSend.apply(this, args);
  };

  const origWinOpen = window.open;
  window.open = function (url, ...rest) {
    if (url && typeof url === "string") {
      post("pdf-url", { url, hint: "window-open", probing: !!window.__tpProbingSalarySlip });
      if (window.__tpProbingSalarySlip) {
        return { closed: false, close() {}, focus() {}, location: { href: url } };
      }
    }
    return origWinOpen.apply(this, [url, ...rest]);
  };

  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (/\.pdf(\?|$|#)/i.test(href) || /salary|slip|statement|attachment/i.test(a.innerText || "")) {
      post("pdf-url", { url: a.href, hint: "anchor-click", probing: !!window.__tpProbingSalarySlip });
      if (window.__tpProbingSalarySlip) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  function findSalarySlipButton() {
    const labels = Array.from(document.querySelectorAll("div, span, p, label, strong, dt, th"));
    const slipLabel = labels.find((el) => {
      if (el.children.length > 2) return false;
      const t = (el.innerText || "").trim();
      return /^Salary Slip/i.test(t) && t.length < 60;
    });
    if (!slipLabel) return null;

    const isPreviewEl = (el) => {
      const t = (el.innerText || "").trim();
      return /^(Attachment\s*Preview|Preview|View|Download|Open)$/i.test(t) && el.children.length <= 2;
    };

    // 1. Walk immediate single-field container first
    let cur = slipLabel.parentElement;
    for (let i = 0; i < 4 && cur; i++) {
      if (/Work ID|Contract Photo|Electronic Contract|On-site Photos|Photo of Signature/i.test(cur.innerText || "")) break;
      const btns = Array.from(cur.querySelectorAll("button, a, [role='button'], .el-button, span, div")).filter(isPreviewEl);
      if (btns.length) return btns[0].closest("button, a, [role='button'], .el-button") || btns[0];
      cur = cur.parentElement;
    }

    // 2. Spatial fallback: find the Attachment Preview button directly beneath Salary Slip in the same column
    const lRect = slipLabel.getBoundingClientRect();
    if (lRect && lRect.width > 0) {
      const allBtns = Array.from(document.querySelectorAll("button, a, [role='button'], .el-button, span, div")).filter(isPreviewEl);
      let best = null;
      let bestDist = Infinity;
      for (const b of allBtns) {
        const r = b.getBoundingClientRect();
        if (!r || r.width === 0) continue;
        const dy = r.top - lRect.top;
        const dx = Math.abs(r.left - lRect.left);
        if (dy >= -8 && dy <= 140 && dx <= 160) {
          const dist = dy + dx * 0.5;
          if (dist < bestDist) {
            bestDist = dist;
            best = b.closest("button, a, [role='button'], .el-button") || b;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  let probeStopTimer = null;
  let probeObs = null;

  function stopSalarySlipProbe() {
    if (probeStopTimer) { clearTimeout(probeStopTimer); probeStopTimer = null; }
    if (probeObs) { probeObs.disconnect(); probeObs = null; }
    window.__tpProbingSalarySlip = false;
  }

  function scanAndCloseProbeDialogs() {
    let captured = false;
    document.querySelectorAll(".el-dialog__wrapper, .el-dialog, .el-overlay, [role='dialog'], .el-image-viewer__wrapper").forEach((dlg) => {
      const style = window.getComputedStyle(dlg);
      if (style.display === "none" || style.visibility === "hidden") return;
      dlg.querySelectorAll("iframe[src], embed[src], object[data], a[href*='.pdf'], .el-image-viewer__img").forEach((el) => {
        const u = el.currentSrc || el.src || el.data || el.href || "";
        if (u && u !== "about:blank" && !u.startsWith("chrome-extension://") && !u.startsWith("javascript:")) {
          post("pdf-url", { url: u, hint: "probe-dom", probing: true });
          captured = true;
        }
      });
      const closeBtn = dlg.querySelector(".el-dialog__headerbtn, .el-dialog__close, .el-image-viewer__close, [aria-label='Close'], .close");
      if (closeBtn) closeBtn.click();
    });
    if (captured) {
      setTimeout(stopSalarySlipProbe, 120);
    }
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d) return;
    if (d.source === "TOPPAY_CONTENT_READY") {
      eventBuffer.forEach((msg) => {
        try { window.postMessage(msg, "*"); } catch { /* ignore */ }
      });
      return;
    }
    if (d.source !== "TOPPAY_PROBE_SALARY_SLIP") return;
    const btn = findSalarySlipButton();
    if (!btn) {
      post("probe-miss", { reason: "button-not-found" });
      return;
    }
    stopSalarySlipProbe();
    window.__tpProbingSalarySlip = true;

    probeObs = new MutationObserver(() => scanAndCloseProbeDialogs());
    probeObs.observe(document.body, { childList: true, subtree: true, attributes: true });

    probeStopTimer = setTimeout(() => {
      scanAndCloseProbeDialogs();
      stopSalarySlipProbe();
    }, 4600);

    try { btn.click(); } catch { /* ignore */ }
  });
})();
