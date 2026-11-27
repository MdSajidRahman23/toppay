// TopPay Smart Decision Assistant - runs on web.toppaybd.com audit pages.
// Reads the page, auto-reads Salary Slip / bKash Statement PDFs, checks phones + NID (OCR + PDF parsing run on THIS computer),
// and evaluates the SOP rules locally in <0.5ms. Only derived numbers, flags and template ids ever go to the server.
(function () {
  "use strict";
  if (window.__toppayV3) return;
  window.__toppayV3 = true;
  const Core = window.TPCore;
  const Engine = window.TPEngine;

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    });
    kids.flat(Infinity).forEach((c) => { if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function copyText(txt, btn, origLabel) {
    if (!txt) return;
    const done = () => {
      if (!btn) return;
      btn.textContent = "✅ Copied";
      setTimeout(() => { btn.textContent = origLabel || "📋 Copy"; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(txt)).then(done).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = String(txt);
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch {}
        ta.remove(); done();
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = String(txt);
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove(); done();
    }
  }
  function copyBtn(val, label = "📋 Copy") {
    return h("button", {
      class: "tp-hbtn",
      style: "padding:1px 6px;font-size:10px;margin-left:6px",
      disabled: !val,
      title: val ? `Copy: ${val}` : "পাওয়া যায়নি",
      onclick: (e) => { e.stopPropagation(); copyText(val, e.currentTarget, label); }
    }, label);
  }

  function sendOnce(m) {
    return new Promise((res) => {
      try {
        chrome.runtime.sendMessage(m, (r) => {
          const err = chrome.runtime.lastError;
          if (err) res({ ok: false, error: err.message || "runtime error", _retryable: true });
          else res(r || { ok: false, error: "no answer", _retryable: true });
        });
      } catch (e) {
        res({ ok: false, error: String(e) });
      }
    });
  }
  async function send(m) {
    const r = await sendOnce(m);
    if (r && r._retryable) {
      await sleep(120);
      return sendOnce(m);
    }
    return r;
  }

  const routeString = () => `${location.pathname || ""} ${location.hash || ""}`;
  const orderIdFromUrl = () => (routeString().match(/detail\/([a-zA-Z0-9_-]+)/i) || [])[1] || "default";
  const isDetailPage = () => /\/detail\/[a-zA-Z0-9_-]+/i.test(routeString());

  const cache = {};
  const savedLang = (() => { try { return localStorage.getItem("tp_ext_lang") || ""; } catch { return ""; } })();
  const savedPos = (() => { try { return JSON.parse(localStorage.getItem("tp_ext_pos") || "null"); } catch { return null; } })();
  const savedFabPos = (() => { try { return JSON.parse(localStorage.getItem("tp_ext_fab_pos") || "null"); } catch { return null; } })();
  const ui = {
    tab: "Decision", open: true, scanning: false, ocrNote: "", stmtNote: "",
    lang: savedLang === "en" ? "en" : "bn",
    langChosen: Boolean(savedLang === "en" || savedLang === "bn"),
    pos: savedPos,
    fabPos: savedFabPos,
    cfg: { base: "https://toppay-zeta.vercel.app", loggedIn: false }, policy: null, templates: null, busy: false, err: ""
  };
  const isEn = () => ui.lang === "en";
  const tr = (bn, en) => (isEn() ? en : bn);
  function setLang(l) {
    ui.lang = l === "en" ? "en" : "bn";
    ui.langChosen = true;
    try { localStorage.setItem("tp_ext_lang", ui.lang); } catch {}
    render();
  }
  function state() {
    const id = orderIdFromUrl();
    if (!cache[id]) {
      cache[id] = {
        order_id: id, order_no: "", buyer_name: "", imei: "", box_imei: "", box_imeis_found: [], viewer_imei_note: "", imei_photo_missing: false, imei_box_mismatch: false, total_amount: 0, down_payment_pct: "", term: "", store_risk: "",
        osr_phone: "", customer_phone: "", nid_no: "", family_phone: "", guarantor_name: "", guarantor_phone: "", colleague_name: "", colleague_phone: "",
        relation: "", profession: "", profession_key: "", relation_key: "",
        cust_nid_urls: [], guar_nid_urls: [], cust_nid_count: 0, guar_nid_count: 0,
        cust_photo_nid: "", guar_photo_nid: "", nid_mismatch: false, nid_status: "", cust_dob: "", guar_dob: "", customer_age: null, guarantor_age: null,
        cust_qr_data: null, guar_qr_data: null, cust_qr_front_mismatch: false, guar_qr_front_mismatch: false,
        cust_auth: null, guar_auth: null,
        cust_father: "", cust_mother: "", guar_father: "", guar_mother: "", guar_husband: "",
        ocr_done: {}, ocr_running: false,
        has_work_id: null, has_salary_slip: null, has_onsite_photo: null, has_signature: null, face_verify_empty: false,
        pdf_candidates: [], stmt_url: "", stmt_running: false, stmt_pending_recheck: false, stmt_probing: false, stmt_password_failed: false, stmt_error: "", stmt_analysis: null, stmt_unlocked_with: "",
        stmt_best_month: null, stmt_total_3m: null, stmt_months_covered: null,
        stmt_name_mismatch: false, stmt_guarantor_relation: "", stmt_forbidden_hit: false, stmt_forbidden_hits: [], stmt_return_tid: "",
        audit_history: [], phone_findings: [], answers: {}, ignored: new Set(), dismissed: new Set(), result: null, manualAge: null, manualGAge: null, api_extracted: false,
      };
    }
    return cache[id];
  }

  function resolveUrl(u) {
    if (!u) return "";
    if (/^(https?:|blob:|data:)/i.test(u)) return u;
    try { return new URL(u, location.origin).href; } catch { return u; }
  }

  function rememberPdfCandidate(st, url, priority, tag) {
    const abs = resolveUrl(url);
    if (!abs || abs.startsWith("javascript:") || abs.startsWith("chrome-extension://") || abs === "#") return;
    const existing = st.pdf_candidates.find((c) => c.url === abs);
    if (existing) {
      if (priority > existing.priority) existing.priority = priority;
      return;
    }
    st.pdf_candidates.push({ url: abs, priority, tag: tag || "" });
    st.pdf_candidates.sort((a, b) => b.priority - a.priority);
  }

  function applyApiScalars(st, s) {
    if (!s || typeof s !== "object") return;
    let touched = false;
    const pick = (...keys) => {
      for (const k of keys) {
        if (s[k] !== undefined && s[k] !== null && String(s[k]).trim() !== "") return String(s[k]).trim();
      }
      return "";
    };
    const orderNo = pick("orderNo", "order_no", "orderCode", "orderSn");
    if (orderNo && !st.order_no) { st.order_no = orderNo; touched = true; }
    const buyer = pick("buyerName", "customerName", "userName", "realName", "receiverName");
    if (buyer && !st.buyer_name) { st.buyer_name = buyer; touched = true; }
    const imei = pick("imei", "imei1", "deviceImei");
    if (imei && !st.imei) { st.imei = imei; touched = true; }
    const amt = pick("totalProductAmount", "totalAmount", "productAmount", "orderAmount", "originalPrice");
    if (amt && !st.total_amount) {
      const n = parseFloat(amt.replace(/,/g, ""));
      if (n > 0) { st.total_amount = n; touched = true; }
    }
    const dp = pick("downPaymentRatio", "downPaymentPct", "downPaymentRate", "firstPayRatio");
    if (dp && !st.down_payment_pct) { st.down_payment_pct = dp.replace(/%/g, ""); touched = true; }
    const term = pick("term", "loanTerm", "installmentTerm", "periods");
    if (term && !st.term) { st.term = /term/i.test(term) ? term : term + " Term"; touched = true; }
    const risk = pick("storeRiskCategory", "riskCategory", "storeRisk");
    if (risk && !st.store_risk) { st.store_risk = risk; touched = true; }
    const nid = pick("idCardNo", "nidNo", "idNumber", "certNo", "identityNo");
    if (nid && !st.nid_no) { st.nid_no = nid; touched = true; }
    const cPhone = pick("customerPhone", "userPhone", "buyerPhone", "mobile", "phone");
    if (cPhone && !st.customer_phone) { st.customer_phone = cPhone; touched = true; }
    const osr = pick("salespersonPhone", "osrPhone", "promoterPhone", "shopPhone");
    if (osr && !st.osr_phone) { st.osr_phone = osr; touched = true; }
    const fam = pick("familyPhone", "familyContactPhone", "homePhone");
    if (fam && !st.family_phone && !/^empty$/i.test(fam)) { st.family_phone = fam; touched = true; }
    const gName = pick("guarantorName", "emergencyContactName", "urgentName");
    if (gName && !st.guarantor_name) { st.guarantor_name = gName; touched = true; }
    const gPhone = pick("guarantorPhone", "emergencyContactPhone", "urgentPhone");
    if (gPhone && !st.guarantor_phone) { st.guarantor_phone = gPhone; touched = true; }
    const colName = pick("colleagueName", "workmateName");
    if (colName && !st.colleague_name) { st.colleague_name = colName; touched = true; }
    const colPhone = pick("colleaguePhone", "colleagueContactPhone", "workmatePhone");
    if (colPhone && !st.colleague_phone) { st.colleague_phone = colPhone; touched = true; }
    const rel = pick("guarantorRelation", "relation", "relationship");
    if (rel && !st.relation) { st.relation = rel; touched = true; }
    const PROF_NUM_LABELS = {
      "1": "Job Holder",
      "2": "Businessman",
      "3": "Student",
      "4": "House Owner",
      "5": "Rider",
      "6": "Unemployed",
      "7": "Other",
    };
    const prof = pick("profession", "occupation", "jobType");
    if (prof && !st.profession) { st.profession = PROF_NUM_LABELS[prof] || prof; touched = true; }
    if (touched) {
      st.api_extracted = true;
      if (isDetailPage()) decideSoon();
    }
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "TOPPAY_MAIN_EVENT") return;
    const st = state();
    if (m.kind === "api-data" && m.scalars) {
      applyApiScalars(st, m.scalars);
      return;
    }
    if (m.kind === "api-pdfs" && Array.isArray(m.pdfs)) {
      const prevTop = st.pdf_candidates[0] ? st.pdf_candidates[0].url : "";
      m.pdfs.forEach((p) => {
        const combo = ((p.path || "") + " " + (p.url || "")).toLowerCase();
        if (/contract|consent|agreement|work.?id|login.?id|signature|onsite|face/i.test(combo)) return;
        const isSlip = /salary|slip|statement|bank|bkash|nagad|income|payslip/i.test(combo);
        const isPdf = /\.pdf(\?|$|#)/i.test(p.url || "");
        if (isSlip || isPdf) {
          rememberPdfCandidate(st, p.url, (isSlip ? 140 : 40) + (isPdf ? 20 : 0), p.path);
        }
      });
      const newTop = st.pdf_candidates[0] ? st.pdf_candidates[0].url : "";
      const topPrio = st.pdf_candidates[0] ? st.pdf_candidates[0].priority : 0;
      if (isDetailPage() && newTop && (!st.stmt_analysis || (newTop !== prevTop && topPrio >= 100) || st.stmt_probing)) {
        if (st.stmt_running) st.stmt_pending_recheck = true;
        else maybeAnalyzeBestPdf(st, true);
      }
    } else if (m.kind === "pdf-url" && m.url) {
      const prevTop = st.pdf_candidates[0] ? st.pdf_candidates[0].url : "";
      const isProbeHit = Boolean(m.probing || st.stmt_probing);
      const prio = isProbeHit ? 240 : (/\.pdf(\?|$|#)/i.test(m.url) ? 95 : 55);
      rememberPdfCandidate(st, m.url, prio, m.hint || "");
      const newTop = st.pdf_candidates[0] ? st.pdf_candidates[0].url : "";
      if (isDetailPage() && newTop && (!st.stmt_analysis || isProbeHit || newTop !== prevTop)) {
        if (isProbeHit) st.stmt_probe_override = true;
        if (st.stmt_running) st.stmt_pending_recheck = true;
        else maybeAnalyzeBestPdf(st, true);
      }
    }
  });

  function findCardOrLabelValue(label) {
    const lowLabel = label.toLowerCase();
    for (const card of document.querySelectorAll(".contact-card")) {
      const head = card.querySelector(".card-header")?.innerText || "";
      if (head.toLowerCase().includes(lowLabel)) return (card.querySelector(".card-content")?.innerText || "").trim();
    }
    const items = document.querySelectorAll(".card-header, .cell-item, .el-descriptions__label, .el-form-item__label, th, td, span, div, p, label");
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixRe = new RegExp("^" + esc + "\\s*:?\\s*", "i");
    for (const it of items) {
      if (it.children.length > 2) continue;
      const txt = (it.innerText || "").trim();
      if (txt.toLowerCase().startsWith(lowLabel) && txt.length < label.length + 60) {
        const parent = it.closest(".contact-card") || it.closest(".el-descriptions__row") || it.closest(".el-form-item") || it.closest("tr") || it.parentElement;
        if (parent) {
          const cleaned = (parent.innerText || "").trim().replace(prefixRe, "").trim();
          if (cleaned && cleaned.toLowerCase() !== lowLabel) return cleaned.split("\n")[0].trim();
        }
      }
    }
    return "";
  }

  function detectNidImages(st) {
    const els = Array.from(document.querySelectorAll("div, span, p, label, strong, th, td"));
    let custLabel = null, guarLabel = null;
    for (const el of els) {
      if (el.children.length > 2) continue;
      const t = (el.innerText || "").trim();
      if (/^ID Card\s*:?$/i.test(t)) custLabel = el;
      if (/^Guarantor ID\s*:?$/i.test(t)) guarLabel = el;
    }
    if (!custLabel && !guarLabel) return;
    const okImg = (im) => (im.currentSrc || im.src) && !im.src.startsWith("data:image/svg");
    function collect(label, forbidden) {
      if (!label) return [];
      let cur = label.parentElement;
      for (let i = 0; i < 5 && cur; i++) {
        if (forbidden.test(cur.innerText || "")) break;
        const imgs = Array.from(cur.querySelectorAll("img")).filter(okImg);
        if (imgs.length) return imgs;
        cur = cur.parentElement;
      }
      return [];
    }
    let c = collect(custLabel, /Guarantor ID|ID Card No\./i);
    let g = collect(guarLabel, /^ID Card:|ID Card No\./i);
    if ((!c.length || !g.length) && custLabel && guarLabel) {
      let shared = custLabel.parentElement;
      for (let i = 0; i < 6 && shared; i++) { if (shared.contains(guarLabel)) break; shared = shared.parentElement; }
      if (shared) {
        const cy = custLabel.getBoundingClientRect().top, gy = guarLabel.getBoundingClientRect().top;
        const all = Array.from(shared.querySelectorAll("img")).filter(okImg);
        if (!c.length) c = all.filter((im) => { const y = im.getBoundingClientRect().top; return y >= cy - 10 && y < gy; });
        if (!g.length) g = all.filter((im) => im.getBoundingClientRect().top >= gy - 10);
      }
    }
    if (c.length) { st.cust_nid_count = c.length; st.cust_nid_urls = c.map((im) => im.currentSrc || im.src); }
    if (g.length) { st.guar_nid_count = g.length; st.guar_nid_urls = g.map((im) => im.currentSrc || im.src); }
  }

  function detectSalarySlipDom(st) {
    const els = Array.from(document.querySelectorAll("div, span, p, label, strong, dt, th"));
    const slipLabel = els.find((el) => el.children.length <= 2 && /^Salary Slip/i.test((el.innerText || "").trim()) && (el.innerText || "").trim().length < 60);
    if (!slipLabel) return;
    let cur = slipLabel.parentElement;
    for (let i = 0; i < 5 && cur; i++) {
      if (/Work ID|Contract Photo|Electronic Contract|On-site Photos|Photo of Signature/i.test(cur.innerText || "")) break;
      const link = cur.querySelector("a[href*='.pdf'], iframe[src], embed[src], object[data], [data-url], [data-src]");
      if (link) {
        const u = link.href || link.src || link.data || link.dataset.url || link.dataset.src || "";
        if (u && u !== "#") rememberPdfCandidate(st, u, 180, "dom-salary-slip");
      }
      cur = cur.parentElement;
    }
  }

  function extract() {
    const st = state();
    const body = document.body ? (document.body.innerText || "") : "";
    let m;
    if ((m = body.match(/Order No\.?\s*:?\s*([a-zA-Z0-9_-]+)/i))) st.order_no = m[1];
    if ((m = body.match(/Buyer\s*\/\s*Receiver\s*:?\s*([^\n\r]+?)(?=\s+IMEI|\s+Order Status|\n)/i))) st.buyer_name = m[1].trim();
    if ((m = body.match(/IMEI\s*:?\s*(\d{10,20})/i))) st.imei = m[1];
    if ((m = body.match(/Total Product Amount:\s*([\d,.]+)\s*TK/i) || body.match(/Original Price:\s*([\d,.]+)/i))) st.total_amount = parseFloat(m[1].replace(/,/g, "")) || 0;
    if ((m = body.match(/Down payment:\s*(\d+)\s*%/i))) st.down_payment_pct = m[1];
    if ((m = body.match(/Term:\s*(\d+\s*Term)/i))) st.term = m[1];

    const set = (key, label) => { const v = findCardOrLabelValue(label); if (v) st[key] = v; };
    set("osr_phone", "Shop Salesperson Contact No.");
    set("store_risk", "Store Risk Category");
    set("customer_phone", "Customer Phone");
    set("nid_no", "ID Card No.");
    set("guarantor_name", "Guarantor Name");
    set("guarantor_phone", "Guarantor Phone");
    set("colleague_name", "Colleague name");
    set("colleague_phone", "Colleague contact number");
    set("relation", "Relation");
    const cn = findCardOrLabelValue("Customer Name");
    if (cn && !st.buyer_name) st.buyer_name = cn;
    const fam = findCardOrLabelValue("Family Phone");
    if (fam !== "") st.family_phone = /^empty$/i.test(fam) ? "" : fam;

    if (body.includes("Identity Information") || body.includes("ID Card")) detectNidImages(st);

    if (body.includes("Audit Opinion:")) {
      const ops = [];
      const re = /Audit Opinion:\s*([^\n\r]+)/g;
      while ((m = re.exec(body))) { const op = m[1].trim(); if (op && op !== "Approved") ops.push(op); }
      if (ops.length) st.audit_history = ops;
    }
    if ((m = body.match(/Profession:\s*([^\n\r]+)/i))) st.profession = m[1].trim();
    if (body.includes("Attachment Information") || body.includes("On-site Photos") || body.includes("Salary Slip") || body.includes("Photo of Signature")) {
      const detectAttachmentPresence = (label) => {
        const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const labelRe = new RegExp("^" + esc + "\\s*:?$", "i");
        const nodes = Array.from(document.querySelectorAll("div, span, p, label, strong, dt, th, td"));
        const lblEl = nodes.find((el) => el.children.length <= 2 && labelRe.test((el.innerText || "").trim()));
        if (lblEl) {
          let cur = lblEl.parentElement;
          for (let i = 0; i < 4 && cur; i++) {
            const hasMedia = cur.querySelector("img:not([src^='data:image/svg']), a[href], button, canvas, video, iframe, embed, object");
            const txt = (cur.innerText || "").replace(labelRe, "").trim();
            if (hasMedia || /Attachment Preview|Preview|View/i.test(txt)) return true;
            if (/^Empty$/i.test(txt)) return false;
            cur = cur.parentElement;
          }
        }
        if (!body.includes(label)) return null;
        return !new RegExp(esc + "[^:\\n]*:\\s*\\n?\\s*Empty", "i").test(body);
      };
      const wId = detectAttachmentPresence("Work ID / Login ID");
      if (wId !== null) st.has_work_id = wId;
      const sSlip = detectAttachmentPresence("Salary Slip");
      if (sSlip !== null) st.has_salary_slip = sSlip;
      const oPhoto = detectAttachmentPresence("On-site Photos");
      if (oPhoto !== null) st.has_onsite_photo = oPhoto;
      const sig = detectAttachmentPresence("Photo of Signature");
      if (sig !== null) st.has_signature = sig;
      const facePresent = detectAttachmentPresence("Face Verification Photo");
      if (facePresent !== null) st.face_verify_empty = !facePresent;
      if (st.has_salary_slip) detectSalarySlipDom(st);
    }
    const resolvedProf = st.profession_key || (st.answers && st.answers.profession) || Core.mapProfession(st.profession);
    st.phone_findings = Core.phoneChecks([
      { key: "osr", label: "Shop OSR", val: st.osr_phone }, { key: "customer", label: "Customer", val: st.customer_phone },
      { key: "guarantor", label: "Guarantor", val: st.guarantor_phone }, { key: "family", label: "Family", val: st.family_phone },
      { key: "colleague", label: "Colleague", val: st.colleague_phone },
    ], resolvedProf);
    return st;
  }

  let frame = null, frameReady = null, jobs = new Map(), jobSeq = 0;
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || (m.type !== "ocr-result" && m.type !== "pdf-result" && m.type !== "ocr-ready")) return;
    if ((m.type === "ocr-result" || m.type === "pdf-result") && jobs.has(m.id)) { jobs.get(m.id)(m); jobs.delete(m.id); }
  });
  function ocrFrame() {
    if (frameReady && frame && document.body && document.body.contains(frame)) return frameReady;
    frame = h("iframe", { src: chrome.runtime.getURL("ocr.html"), style: "display:none;width:0;height:0;border:0" });
    frameReady = new Promise((res) => {
      const on = (e) => { if (e.data && e.data.type === "ocr-ready" && e.source === frame.contentWindow) { window.removeEventListener("message", on); res(frame); } };
      window.addEventListener("message", on);
    });
    (document.body || document.documentElement).appendChild(frame);
    return frameReady;
  }
  async function ocr(url, sys, force, mode, side) {
    if (!force && !mode && side !== "back") {
      try {
        const hit = await send({ type: "ocrCacheGet", url });
        if (hit && hit.hit && Array.isArray(hit.texts) && hit.texts.length) {
          const parsedHit = Core.parseNidTexts(hit.texts);
          if (parsedHit.numbers.length > 0 && parsedHit.dob) {
            return { type: "ocr-result", texts: hit.texts, qrCodes: hit.qrCodes || [], forensics: hit.forensics || null, cached: true };
          }
        }
      } catch { /* ignore cache miss */ }
    }
    const f = await ocrFrame();
    const id = ++jobSeq;
    const resObj = await new Promise((res) => {
      const t = setTimeout(() => { jobs.delete(id); res({ error: "timeout" }); }, 150000);
      jobs.set(id, (m) => { clearTimeout(t); res(m); });
      f.contentWindow.postMessage({ type: "ocr-request", id, url, sys: Core.digitsOf(sys), mode: mode || "", side: side || "" }, "*");
    });
    if (resObj && Array.isArray(resObj.texts) && resObj.texts.length) {
      const parsedNew = Core.parseNidTexts(resObj.texts);
      if (parsedNew.numbers.length > 0 && parsedNew.dob) {
        send({ type: "ocrCacheSet", url, texts: resObj.texts, qrCodes: resObj.qrCodes || [], forensics: resObj.forensics || null }).catch(() => {});
      }
    }
    return resObj;
  }

  async function analyzePdfInSandbox(st, urlOrBuffer, isBuffer) {
    const f = await ocrFrame();
    const id = ++jobSeq;
    const t = Core.dhakaToday();
    const appDate = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    const passwords = [
      st.customer_phone ? Core.normalizePhone(st.customer_phone) : "",
      st.guarantor_phone ? Core.normalizePhone(st.guarantor_phone) : "",
    ].filter(Boolean);
    const rel = st.relation_key || (st.answers && st.answers.guarantor_relation) || Core.mapRelation(st.relation) || "";
    const p = ui.policy || {};
    const cfg = {
      minMonth: p.min_month_tx || 2000,
      fastTrack: p.fast_track_tx || 6000,
      highMrp: p.high_mrp || 50000,
      highMrpTx3: p.high_mrp_tx3 || 15000,
      tx3Exempt: p.tx3_exempt || 30000,
      tolerance: p.money_tolerance || 60,
      months: p.statement_months || 3,
      excludeLastDays: p.exclude_last_days || 7,
    };

    let buffer = isBuffer ? urlOrBuffer : null;
    let url = isBuffer ? "" : urlOrBuffer;
    if (!buffer && url.startsWith("blob:")) {
      const resp = await fetch(url);
      buffer = await resp.arrayBuffer();
      url = "";
    }

    return new Promise((res) => {
      const timer = setTimeout(() => { jobs.delete(id); res({ error: "PDF পড়তে সময় বেশি লাগছে (timeout)" }); }, 45000);
      jobs.set(id, (m) => { clearTimeout(timer); res(m); });
      const msg = {
        type: "pdf-request",
        id,
        url,
        buffer,
        passwords,
        customerName: st.buyer_name || "",
        guarantorName: st.guarantor_name || "",
        guarantorRelation: rel,
        appDate,
        cfg,
        lang: ui.lang,
      };
      if (buffer) f.contentWindow.postMessage(msg, "*", [buffer]);
      else f.contentWindow.postMessage(msg, "*");
    });
  }

  function applyStatementAnalysis(st, a, unlockedWith) {
    st.stmt_analysis = a;
    st.stmt_unlocked_with = unlockedWith || "";
    st.stmt_password_failed = false;
    st.stmt_error = "";
    st.stmt_best_month = Math.round(a.sop.best);
    st.stmt_total_3m = Math.round(a.sop.total3);
    st.stmt_months_covered = a.sop.covered;
    st.stmt_name_mismatch = a.holderCheck.status === "ok_guarantor_fb";
    st.stmt_guarantor_relation = a.holderCheck.status === "ok_guarantor_fb"
      ? (st.relation_key || (st.answers && st.answers.guarantor_relation) || Core.mapRelation(st.relation) || "")
      : "";
    st.stmt_forbidden_hits = Array.isArray(a.forbiddenHits) ? a.forbiddenHits : [];
    st.stmt_forbidden_hit = st.stmt_forbidden_hits.length > 0;
    st.stmt_return_tid = a.holderCheck.returnTid || "";
    if (st.answers && Object.prototype.hasOwnProperty.call(st.answers, "name_mismatch")) {
      delete st.answers.name_mismatch;
    }
  }

  function getPortalTabs() {
    const names = ["Product Installments", "Basic & Identity", "Audit History", "Attachment Information"];
    const normTxt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const tabs = Array.from(document.querySelectorAll(".el-tabs__item, [role='tab'], div, span, li, a"))
      .filter((el) => el.children.length <= 2 && names.includes(normTxt(el)));
    const uniqueTabs = [];
    const seenNames = new Set();
    for (const el of tabs) {
      const n = normTxt(el);
      if (!seenNames.has(n)) { seenNames.add(n); uniqueTabs.push(el); }
    }
    const active = uniqueTabs.find((el) => ((el.className || "") + " " + (el.parentElement?.className || "") + " " + (el.getAttribute("aria-selected") || "")).match(/active|is-active|true/)) || uniqueTabs[0];
    return { uniqueTabs, active, normTxt };
  }

  async function probeSalarySlipAttachment(st, force) {
    if (st.stmt_probing) return;
    st.stmt_probing = true;
    const { uniqueTabs, active, normTxt } = getPortalTabs();
    const attTab = uniqueTabs.find((el) => normTxt(el) === "Attachment Information");
    const switchedTab = Boolean(attTab && active && attTab !== active);
    const beforeCount = st.pdf_candidates.length;
    const beforeTop = st.pdf_candidates[0] ? st.pdf_candidates[0].url : "";

    try {
      if (switchedTab) {
        attTab.click();
        await sleep(340);
        extract();
      }
      if (st.has_salary_slip === false && !force) return;

      window.postMessage({ source: "TOPPAY_PROBE_SALARY_SLIP" }, "*");

      // Poll up to 4200ms and stop immediately once a Salary Slip probe candidate URL arrives
      const deadline = Date.now() + 4200;
      while (Date.now() < deadline) {
        await sleep(160);
        const topCand = st.pdf_candidates[0];
        const curTop = topCand ? topCand.url : "";
        if ((topCand && topCand.priority >= 200 && curTop !== beforeTop) || st.pdf_candidates.length > beforeCount) {
          break;
        }
      }
    } finally {
      st.stmt_probing = false;
      if (switchedTab && active) {
        try { active.click(); } catch {}
        await sleep(60);
      }
    }
  }

  async function rereadStatementNow(st) {
    if (st.stmt_running || st.stmt_probing) return;
    st.stmt_error = "";
    st.stmt_explicit_reread = true;
    ui.stmtNote = tr("Salary Slip / Statement খোঁজা হচ্ছে…", "Searching Salary Slip / Statement…");
    render();
    try {
      await probeSalarySlipAttachment(st, true);
      if (st.pdf_candidates.length) {
        await maybeAnalyzeBestPdf(st, true);
      } else {
        ui.stmtNote = "";
        render();
      }
    } finally {
      st.stmt_explicit_reread = false;
    }
  }

  async function maybeAnalyzeBestPdf(st, force) {
    if (st.stmt_running) {
      if (force) st.stmt_pending_recheck = true;
      return;
    }
    if (!st.pdf_candidates.length) return;
    const top = st.pdf_candidates[0];
    if (!force && st.stmt_url === top.url && st.stmt_analysis) return;

    const prevGoodAnalysis = (st.stmt_analysis && st.stmt_analysis.sop && st.stmt_analysis.sop.covered >= 3 && !st.stmt_error)
      ? { analysis: st.stmt_analysis, unlockedWith: st.stmt_unlocked_with, url: st.stmt_url }
      : null;

    st.stmt_running = true;
    st.stmt_pending_recheck = false;
    st.stmt_url = top.url;
    st.stmt_error = "";
    ui.stmtNote = "Salary Slip / Statement PDF পড়া হচ্ছে…";
    render();

    try {
      let res = await analyzePdfInSandbox(st, top.url, false);
      let anyPwFail = Boolean(res && res.passwordFailed);
      if ((!res || !res.analysis) && st.pdf_candidates.length > 1) {
        for (let i = 1; i < st.pdf_candidates.length; i++) {
          const alt = st.pdf_candidates[i];
          const tryAlt = await analyzePdfInSandbox(st, alt.url, false);
          if (tryAlt && tryAlt.passwordFailed) anyPwFail = true;
          if (tryAlt && tryAlt.analysis) {
            res = tryAlt;
            st.stmt_url = alt.url;
            break;
          }
        }
      }
      const forceApply = Boolean(st.stmt_explicit_reread || st.stmt_probe_override);
      st.stmt_probe_override = false;
      if (res && res.analysis && (!prevGoodAnalysis || forceApply || (res.analysis.sop && res.analysis.sop.covered > 0))) {
        applyStatementAnalysis(st, res.analysis, res.unlockedWith);
      } else if (prevGoodAnalysis && !forceApply) {
        // Keep previously verified 3/3 mos statement analysis intact during general page re-scan
        st.stmt_url = prevGoodAnalysis.url;
        applyStatementAnalysis(st, prevGoodAnalysis.analysis, prevGoodAnalysis.unlockedWith);
      } else if (res && res.analysis) {
        applyStatementAnalysis(st, res.analysis, res.unlockedWith);
      } else {
        st.stmt_password_failed = Boolean((res && res.passwordFailed) || anyPwFail);
        st.stmt_error = (res && res.error) || "PDF পড়া যায়নি";
      }
    } catch (e) {
      st.stmt_password_failed = false;
      st.stmt_error = String((e && e.message) || e);
    } finally {
      st.stmt_running = false;
      ui.stmtNote = "";
      await decide();
      if (st.stmt_pending_recheck) {
        st.stmt_pending_recheck = false;
        setTimeout(() => maybeAnalyzeBestPdf(st, true), 50);
      }
    }
  }

  async function analyzeLocalPdfFile(st, file) {
    if (!file || st.stmt_running) return;
    st.stmt_running = true;
    st.stmt_error = "";
    ui.stmtNote = `${file.name} পড়া হচ্ছে…`;
    render();
    try {
      const buf = await file.arrayBuffer();
      const res = await analyzePdfInSandbox(st, buf, true);
      if (res && res.analysis) {
        applyStatementAnalysis(st, res.analysis, res.unlockedWith);
      } else {
        st.stmt_password_failed = Boolean(res && res.passwordFailed);
        st.stmt_error = (res && res.error) || "PDF পড়া যায়নি";
      }
    } catch (e) {
      st.stmt_password_failed = false;
      st.stmt_error = String((e && e.message) || e);
    } finally {
      st.stmt_running = false;
      ui.stmtNote = "";
      await decide();
    }
  }

  async function runOcr(st, force) {
    if (st.ocr_running) return;
    const jobsList = [];
    if (st.cust_nid_urls[0]) jobsList.push({ role: "cust", side: "front", url: st.cust_nid_urls[0] });
    if (st.guar_nid_urls[0]) jobsList.push({ role: "guar", side: "front", url: st.guar_nid_urls[0] });
    st.cust_nid_urls.slice(1).forEach((u) => jobsList.push({ role: "cust", side: "back", url: u }));
    st.guar_nid_urls.slice(1).forEach((u) => jobsList.push({ role: "guar", side: "back", url: u }));

    const todo = jobsList.filter((j) => force || !st.ocr_done[j.url]);
    if (!todo.length) return;
    st.ocr_running = true; ui.ocrNote = "⚡ NID ছবি দ্রুত পড়া হচ্ছে…"; render();
    const texts = { cust: [], guar: [] };
    const frontTexts = { cust: [], guar: [] };
    const backTexts = { cust: [], guar: [] };
    const qrHits = { cust: [], guar: [] };
    let frontCustNid = "", frontCustDob = "", backCustNid = "", backCustDob = "", custForensics = null;
    let frontGuarNid = "", frontGuarDob = "", backGuarNid = "", backGuarDob = "", guarForensics = null;

    const applyParsed = () => {
      const c = Core.parseNidTexts(texts.cust);
      let cQr = qrHits.cust.length ? Core.parseNidQrPayload(qrHits.cust) : null;
      if ((!cQr || !cQr.found) && (c.mrzNid || c.mrzDob)) {
        cQr = { found: true, format: "MRZ", raw: "", nid: c.mrzNid || "", dob: c.mrzDob || "", name: "", father: "", mother: "" };
      }
      if (cQr && cQr.found) {
        st.cust_qr_data = cQr;
        if (cQr.father && !st.cust_father) st.cust_father = cQr.father;
        if (cQr.mother && !st.cust_mother) st.cust_mother = cQr.mother;
      }
      if (cQr && cQr.nid && !c.numbers.includes(cQr.nid)) c.numbers.unshift(cQr.nid);
      if (cQr && cQr.dob && !c.dob) c.dob = { iso: cQr.dob, count: 3 };

      if (texts.cust.length || (cQr && cQr.found)) {
        if (st.nid_no) {
          const hit = c.numbers.find((n) => Core.nidNumbersMatch(n, st.nid_no));
          if (hit) { st.cust_photo_nid = hit; st.nid_mismatch = false; st.nid_status = "match"; }
          else if (c.numbers.length) { st.cust_photo_nid = c.numbers[0]; st.nid_mismatch = true; st.nid_status = "mismatch"; }
          else { st.cust_photo_nid = ""; st.nid_mismatch = false; st.nid_status = "unreadable"; }
        } else { st.cust_photo_nid = c.numbers[0] || ""; st.nid_status = c.numbers.length ? "no-system" : "unreadable"; }
        if (c.dob) { st.cust_dob = c.dob.iso; const a = Core.ageFromIso(c.dob.iso); if (a) st.customer_age = a.decimal; }
        st.cust_qr_front_mismatch = Boolean(frontCustNid && cQr && cQr.nid && !Core.nidNumbersMatch(frontCustNid, cQr.nid));
        if (st.cust_qr_front_mismatch) st.nid_mismatch = true;
      }

      const g = Core.parseNidTexts(texts.guar);
      let gQr = qrHits.guar.length ? Core.parseNidQrPayload(qrHits.guar) : null;
      if ((!gQr || !gQr.found) && (g.mrzNid || g.mrzDob)) {
        gQr = { found: true, format: "MRZ", raw: "", nid: g.mrzNid || "", dob: g.mrzDob || "", name: "", father: "", mother: "" };
      }
      if (gQr && gQr.found) {
        st.guar_qr_data = gQr;
        if (gQr.father && !st.guar_father) st.guar_father = gQr.father;
        if (gQr.mother && !st.guar_mother) st.guar_mother = gQr.mother;
      }
      if (gQr && gQr.nid && !g.numbers.includes(gQr.nid)) g.numbers.unshift(gQr.nid);
      if (gQr && gQr.dob && !g.dob) g.dob = { iso: gQr.dob, count: 3 };

      if (texts.guar.length || (gQr && gQr.found)) {
        if (g.numbers && g.numbers.length) st.guar_photo_nid = g.numbers[0];
        if (g.dob) { st.guar_dob = g.dob.iso; const a = Core.ageFromIso(g.dob.iso); if (a) st.guarantor_age = a.decimal; }
        st.guar_qr_front_mismatch = Boolean(frontGuarNid && gQr && gQr.nid && !Core.nidNumbersMatch(frontGuarNid, gQr.nid));
      }

      if (typeof Core.validateNidAuthenticity === "function") {
        st.cust_auth = Core.validateNidAuthenticity({
          systemNid: st.nid_no,
          frontNid: frontCustNid,
          frontDob: frontCustDob,
          backNid: backCustNid,
          backDob: backCustDob,
          qrData: cQr,
          forensics: custForensics,
          otherPartyNid: st.guar_photo_nid
        });
        if (st.cust_auth.tamperDetected) st.nid_mismatch = true;
        else if (st.nid_no && cQr && cQr.nid && Core.nidNumbersMatch(cQr.nid, st.nid_no)) {
          st.cust_photo_nid = cQr.nid;
          st.nid_mismatch = false;
          st.nid_status = "match";
        }

        st.guar_auth = Core.validateNidAuthenticity({
          systemNid: "",
          frontNid: frontGuarNid,
          frontDob: frontGuarDob,
          backNid: backGuarNid,
          backDob: backGuarDob,
          qrData: gQr,
          forensics: guarForensics,
          otherPartyNid: st.cust_photo_nid || st.nid_no
        });
      }
    };

    try {
      const fronts = todo.filter((j) => j.side === "front");
      const backs = todo.filter((j) => j.side !== "front");

      if (fronts.length) {
        await Promise.all(fronts.map(async (j) => {
          const r = await ocr(j.url, j.role === "cust" ? st.nid_no : "", !!force, "", "front");
          st.ocr_done[j.url] = r.error ? "failed:" + r.error : "done";
          if (r.texts) { texts[j.role].push(...r.texts); frontTexts[j.role].push(...r.texts); }
          if (r.qrCodes && r.qrCodes.length) qrHits[j.role].push(...r.qrCodes);
          if (r.forensics && r.forensics.suspicious) {
            if (j.role === "cust") custForensics = r.forensics;
            else guarForensics = r.forensics;
          }
        }));
        const fc = Core.parseNidTexts(frontTexts.cust);
        if (fc.numbers.length) frontCustNid = fc.numbers[0];
        if (fc.dob) frontCustDob = fc.dob.iso;
        const fg = Core.parseNidTexts(frontTexts.guar);
        if (fg.numbers.length) frontGuarNid = fg.numbers[0];
        if (fg.dob) frontGuarDob = fg.dob.iso;
        applyParsed();
        await decide();
      }

      if (backs.length) {
        ui.ocrNote = tr("📷 NID পেছনের QR / Barcode স্ক্যান হচ্ছে…", "📷 Scanning NID Back QR / Barcode…");
        render();
        await Promise.all(backs.map(async (j) => {
          const r = await ocr(j.url, j.role === "cust" ? st.nid_no : "", !!force, "", "back");
          st.ocr_done[j.url] = r.error ? "failed:" + r.error : "done";
          if (r.texts) { texts[j.role].push(...r.texts); backTexts[j.role].push(...r.texts); }
          if (r.qrCodes && r.qrCodes.length) qrHits[j.role].push(...r.qrCodes);
          if (r.forensics && r.forensics.suspicious) {
            if (j.role === "cust") custForensics = r.forensics;
            else guarForensics = r.forensics;
          }
        }));
        const bc = Core.parseNidTexts(backTexts.cust);
        if (bc.numbers.length) backCustNid = bc.numbers[0];
        if (bc.dob) backCustDob = bc.dob.iso;
        const bgParsed = Core.parseNidTexts(backTexts.guar);
        if (bgParsed.numbers.length) backGuarNid = bgParsed.numbers[0];
        if (bgParsed.dob) backGuarDob = bgParsed.dob.iso;
        applyParsed();
      }
    } finally {
      st.ocr_running = false;
      ui.ocrNote = "";
      await decide();
    }
  }

  let scanGen = 0;
  async function scan(force) {
    if (ui.scanning && !force) return;
    const myGen = ++scanGen;
    ui.scanning = true;
    const st = state();
    // 1. Instant initial extract + <0.5ms local decision before touching any tabs
    extract();
    await decide();

    try {
      const names = ["Product Installments", "Basic & Identity", "Audit History", "Attachment Information"];
      const normTxt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
      const tabs = Array.from(document.querySelectorAll(".el-tabs__item, [role='tab'], div, span, li, a"))
        .filter((el) => el.children.length <= 2 && names.includes(normTxt(el)));
      const uniqueTabs = [];
      const seenNames = new Set();
      for (const el of tabs) {
        const n = normTxt(el);
        if (!seenNames.has(n)) { seenNames.add(n); uniqueTabs.push(el); }
      }
      const active = uniqueTabs.find((el) => ((el.className || "") + " " + (el.parentElement?.className || "") + " " + (el.getAttribute("aria-selected") || "")).match(/active|is-active|true/)) || uniqueTabs[0];

      for (const t of uniqueTabs) {
        if (myGen !== scanGen) return;
        const tName = normTxt(t);
        if (!force && t !== active) {
          if (tName === "Product Installments" && st.total_amount > 0 && st.down_payment_pct) continue;
          if (tName === "Basic & Identity" && st.nid_no && st.customer_phone && st.guarantor_phone && st.cust_nid_urls.length && st.guar_nid_urls.length) continue;
          if (tName === "Attachment Information" && st.has_onsite_photo !== null && st.has_signature !== null && (st.has_salary_slip === false || st.pdf_candidates.length > 0)) continue;
        }
        if (t !== active) {
          t.click();
          await sleep(260);
        }
        extract();
        if (tName === "Attachment Information") {
          const hasGoodStmt = Boolean(st.stmt_analysis && st.stmt_analysis.sop && st.stmt_analysis.sop.covered >= 3 && !st.stmt_error);
          if (st.has_salary_slip && !hasGoodStmt && (!st.pdf_candidates.length || force)) {
            await probeSalarySlipAttachment(st, !!force);
          }
        }
      }
      if (active && myGen === scanGen) {
        active.click();
        await sleep(40);
      }
    } finally {
      if (myGen === scanGen) ui.scanning = false;
    }

    // 2. Run PDF statement check & parallel smart-cropped NID OCR concurrently
    const tasks = [decide()];
    const hasGoodStmt = Boolean(st.stmt_analysis && st.stmt_analysis.sop && st.stmt_analysis.sop.covered >= 3 && !st.stmt_error);
    if (st.pdf_candidates.length && (!st.stmt_analysis || (force && !hasGoodStmt))) {
      tasks.push(maybeAnalyzeBestPdf(st, !!force));
    }
    tasks.push(runOcr(st, !!force));
    await Promise.all(tasks);
  }

  let rulesLoading = null;
  async function ensureRulesBundle(force) {
    if (!force && ui.policy && ui.templates) return;
    if (rulesLoading) return rulesLoading;
    rulesLoading = (async () => {
      try {
        const r = await send({ type: "rulesBundle", force: !!force });
        if (r && r.status === 401) {
          ui.cfg.loggedIn = false;
          ui.err = "Login-এর সময় শেষ। আবার login করুন।";
          return;
        }
        if (r && r.policy) ui.policy = r.policy;
        if (r && r.templates) ui.templates = r.templates;
      } finally {
        rulesLoading = null;
      }
    })();
    return rulesLoading;
  }

  async function decide() {
    const st = state();
    try {
      if (!ui.cfg || !ui.cfg.ok) {
        const c = await send({ type: "cfg" });
        if (c && (c.ok || c.base)) ui.cfg = c;
      }
      if (!ui.cfg.loggedIn) { st.result = null; render(); return; }

      // Background cache sync — NEVER blocks instant local evaluation!
      if (!ui.policy || !ui.templates) {
        ensureRulesBundle(false).then(() => { if (ui.cfg.loggedIn) decide(); });
      }

      const resolvedProf = st.profession_key || (st.answers && st.answers.profession) || Core.mapProfession(st.profession);
      st.phone_findings = Core.phoneChecks([
        { key: "osr", label: "Shop OSR", val: st.osr_phone }, { key: "customer", label: "Customer", val: st.customer_phone },
        { key: "guarantor", label: "Guarantor", val: st.guarantor_phone }, { key: "family", label: "Family", val: st.family_phone },
        { key: "colleague", label: "Colleague", val: st.colleague_phone },
      ], resolvedProf);

      const p = Core.buildPayload(st, ui.policy && ui.policy.mrp_factor, st.ignored);
      if (Engine && typeof Engine.buildCase === "function") {
        ui.err = "";
        st.result = Engine.buildCase(
          p.data,
          p.manual.map((m) => ({ tid: m.tid, kind: m.kind })),
          [...st.dismissed],
          { policy: ui.policy, templates: ui.templates }
        );
        st.lastPayload = p;
      } else {
        const r = await send({ type: "api", method: "POST", path: "/api/check", body: { data: p.data, manual: p.manual.map((m) => ({ tid: m.tid, kind: m.kind })), dismissed: [...st.dismissed] } });
        if (r.status === 401) { ui.cfg.loggedIn = false; ui.err = "Login-এর সময় শেষ। আবার login করুন।"; st.result = null; }
        else if (!r.ok) { ui.err = r.error || "Server error"; }
        else { ui.err = ""; st.result = r.json; st.lastPayload = p; }
      }
    } catch (err) {
      ui.err = "Error: " + (err && err.message ? err.message : String(err));
    }
    render();
  }
  let decideTimer = null;
  const decideSoon = () => { clearTimeout(decideTimer); decideTimer = setTimeout(decide, 15); };

  const STATUS_STYLE = {
    "APPROVED": ["#4ade80", "rgba(34,197,94,.16)"], "ACTION REQUIRED": ["#60a5fa", "rgba(59,130,246,.16)"],
    "RETURNED": ["#fbbf24", "rgba(245,158,11,.18)"], "REJECTED / SUSPECTED FRAUD": ["#f87171", "rgba(239,68,68,.18)"], "MORE INFO NEEDED": ["#fbbf24", "rgba(245,158,11,.14)"],
  };
  function getSel() {
    const en = isEn();
    const prof = [
      ["job_holder", en ? "Job Holder" : "চাকরিজীবী"],
      ["student", en ? "Student" : "ছাত্র/ছাত্রী"],
      ["businessman", en ? "Businessman" : "ব্যবসায়ী"],
      ["rider", "Rider"],
      ["house_owner", en ? "House Owner" : "House owner"],
      ["unemployed", en ? "Unemployed" : "বেকার"],
      ["other", en ? "Other" : "অন্যান্য"],
      ["media_press", "Media/Press"],
      ["ngo_loan", en ? "Loan NGO Staff" : "Loan NGO কর্মী"],
      ["competitor", "Competitor"],
      ["defense", "Defense/Police"],
      ["lawyer", "Lawyer"],
      ["disabled", en ? "Disabled (Not Served)" : "প্রতিবন্ধী"]
    ];
    return {
      profession: prof,
      guarantor_profession: prof,
      guarantor_relation: [
        ["father", en ? "Father" : "বাবা (Father)"],
        ["mother", en ? "Mother" : "মা (Mother)"],
        ["son", en ? "Son" : "ছেলে (Son)"],
        ["daughter", en ? "Daughter" : "মেয়ে (Daughter)"],
        ["brother", en ? "Brother" : "ভাই (Brother)"],
        ["sister", en ? "Sister" : "বোন (Sister)"],
        ["spouse", en ? "Wife / Spouse" : "স্ত্রী (Wife / Spouse)"],
        ["other_relative", en ? "Other Relative" : "অন্য আত্মীয়"],
        ["friend", en ? "Friend" : "বন্ধু"],
        ["colleague", en ? "Colleague" : "সহকর্মী"]
      ],
      job_id_status: [["original", "Original"], ["photocopy", "Photocopy"], ["none", en ? "None" : "নেই"], ["work_photo", "Work photo"], ["visiting_card", "Visiting card"]],
      trade_license_status: [["valid", "Valid"], ["expired", "Expired"], ["none", en ? "None" : "নেই"]],
      spouse_proof: [["marriage_certificate", "Marriage certificate"], ["child_nid", "Child NID"], ["qr_birth_certificate", "QR birth cert"], ["none", en ? "None" : "নেই"]],
      relation_check: [
        ["consistent", en ? "Matched / Consistent" : "মিলেছে"],
        ["pending", en ? "Minor slip (give chance)" : "ছোট ভুল"],
        ["corrected", en ? "Self-corrected" : "নিজে শুধরেছে"],
        ["major", en ? "Completely mismatched" : "একদম মেলেনি"]
      ],
    };
  }
  const NUM = new Set(["customer_age", "guarantor_age", "mrp", "tx_1_month", "tx_3_month", "monthly_salary", "rental_income", "down_payment_pct"]);
  function getBoolLabel(key) {
    const en = isEn();
    const map = {
      tx_1_month: en ? "Best 1-month transaction (Debit + Credit / In + Out combined)" : "সেরা ১ মাসের লেনদেন (Debit + Credit / In + Out মিলিয়ে)",
      tx_3_month: en ? "3-month total transaction (Debit + Credit combined, for MRP 50k+)" : "৩ মাসের মোট লেনদেন (Debit + Credit মিলিয়ে, MRP ৫০k+ হলে)",
      has_shop_photos: en ? "Has shop photo with signboard + owner photo?" : "Signboard সহ shop photo + owner-এর photo আছে?",
      name_mismatch: en ? "Statement/NID name mismatch?" : "Statement/NID-এর নামে মিল নেই (name mismatch)?",
      side_prompting: en ? "Someone prompting from the side on call?" : "পাশ থেকে কেউ বলে দিচ্ছে?",
      has_original_nid: en ? "Has Original NID? (select 'No' if photocopy/scan)" : "Original NID আছে? (না হলে 'না')",
      office_phone_number: en ? "Customer submitted office phone number?" : "Customer অফিসের ফোন নম্বর দিয়েছে?",
      repeat_customer: en ? "Repeat customer?" : "Repeat customer?",
      outside_address_area: en ? "Address outside service area?" : "ঠিকানা সেবা-এলাকার বাইরে?",
      nid_name_mismatch: en ? "Customer NID name mismatch?" : "Customer NID-র নাম মেলেনি?",
      guarantor_nid_name_mismatch: en ? "Guarantor NID name mismatch?" : "Guarantor NID-র নাম মেলেনি?",
      statement_in_business_name: en ? "Statement in business name?" : "Statement ব্যবসার নামে?",
      salary_slip_submitted: en ? "Salary slip submitted?" : "Salary slip দিয়েছে?",
    };
    return map[key] || "";
  }
  const MORE = ["tx_1_month", "tx_3_month", "name_mismatch", "relation_check", "side_prompting", "has_original_nid", "office_phone_number", "repeat_customer", "outside_address_area", "nid_name_mismatch", "guarantor_nid_name_mismatch"];

  function widget(st, key, label) {
    const cur = st.answers[key];
    const set = (v) => { if (v === "" || v === null || v === undefined) delete st.answers[key]; else st.answers[key] = v; decideSoon(); };
    const SEL = getSel();
    let input;
    if (SEL[key]) {
      input = h("select", { class: "tp-in", onchange: (e) => set(e.target.value) }, h("option", { value: "" }, "—"), SEL[key].map(([v, t]) => h("option", { value: v, selected: cur === v }, t)));
    } else if (NUM.has(key)) {
      input = h("input", { class: "tp-in", type: "number", min: "0", value: cur ?? "", onchange: (e) => set(e.target.value === "" ? "" : Number(e.target.value)) });
    } else {
      input = h("select", { class: "tp-in", onchange: (e) => set(e.target.value === "" ? "" : e.target.value === "yes") },
        h("option", { value: "" }, "—"), h("option", { value: "yes", selected: cur === true }, tr("হ্যাঁ", "Yes")), h("option", { value: "no", selected: cur === false }, tr("না", "No")));
    }
    return h("label", { class: "tp-q" }, h("span", null, getBoolLabel(key) || label || key), input);
  }

  function pdfPickerButton(st) {
    const inp = h("input", {
      type: "file",
      accept: "application/pdf,.pdf,image/*",
      style: "display:none",
      onchange: (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) analyzeLocalPdfFile(st, f);
        e.target.value = "";
      }
    });
    const btn = h("button", {
      class: "tp-hbtn",
      style: "margin-top:6px;background:#0f766e;color:#fff",
      disabled: st.stmt_running,
      onclick: () => inp.click()
    }, st.stmt_running ? tr("PDF পড়া হচ্ছে…", "Reading PDF…") : tr("📄 PDF ফাইল বাছুন (ম্যানুয়াল)", "📄 Choose PDF File (Manual)"));
    return h("div", null, inp, btn);
  }

  function statementSummaryCard(st) {
    const a = st.stmt_analysis;
    if (!a && !st.stmt_error && !st.has_salary_slip) return null;
    const kids = [
      h("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px" },
        h("strong", null, tr("📄 Salary Slip / Statement যাচাই", "📄 Salary Slip / Statement Check")),
        h("button", {
          class: "tp-hbtn",
          disabled: st.stmt_running || st.stmt_probing,
          onclick: () => rereadStatementNow(st)
        }, (st.stmt_running || st.stmt_probing) ? tr("পড়া হচ্ছে…", "Reading…") : tr("↻ আবার পড়ুন", "↻ Re-read")))
    ];
    if (st.stmt_error) {
      kids.push(h("div", { class: "tp-err" }, "⚠️ " + st.stmt_error));
      if (st.stmt_password_failed) {
        kids.push(h("div", { style: "color:#fbbf24;font-size:11px;font-weight:700;margin-top:3px" },
          tr("↩ Auto Return (stm.10) যুক্ত হয়েছে — Customer বা Guarantor কারো নম্বর দিয়ে PDF ওপেন হয়নি।",
             "↩ Auto Return (stm.10) added — PDF did not open with Customer or Guarantor phone.")));
      }
      kids.push(pdfPickerButton(st));
      return h("div", { class: "tp-card" }, kids);
    }
    if (!a) {
      kids.push(h("div", { class: "tp-muted" }, st.stmt_running
        ? tr("PDF পড়া হচ্ছে…", "Reading PDF…")
        : tr("Attachment Preview থেকে PDF পাওয়া যায়নি — নিচ থেকে বাছুন বা Attachment Preview ক্লিক করুন।", "No PDF captured from Attachment Preview — pick a file below or click Attachment Preview.")));
      kids.push(pdfPickerButton(st));
      return h("div", { class: "tp-card" }, kids);
    }
    const fmt = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    kids.push(h("div", { class: "tp-muted" }, `Provider: ${a.provider.id.toUpperCase()}${st.stmt_unlocked_with ? " · 🔓 Auto-unlocked" : ""} · ${tr(`কভার: ${a.sop.covered}/৩ মাস`, `Coverage: ${a.sop.covered}/3 mos`)}`));
    kids.push(h("div", { class: a.holderCheck.returnTid ? "tp-err" : "tp-muted" }, a.holderCheck.text));
    if (a.holderCheck.status === "ok_customer") {
      kids.push(h("div", { style: "color:#34d399;font-size:11px;font-weight:700;margin-top:3px" },
        tr("📞 Customer Statement মিলেছে — Guarantor-কে শুধু Missed Call দিলেই হবে।", "📞 Customer Statement Matched — Missed call to Guarantor is enough.")));
    }
    kids.push(h("div", { class: "tp-muted" }, tr(
      `সেরা ১ মাস (Debit + Credit মিলিয়ে): ৳${fmt(a.sop.best)} · ৩ মাসের মোট (In+Out): ৳${fmt(a.sop.total3)}`,
      `Best 1 Month (Debit + Credit): ৳${fmt(a.sop.best)} · 3-Month Total (In+Out): ৳${fmt(a.sop.total3)}`
    )));
    if (a.forbiddenHits && a.forbiddenHits.length) {
      kids.push(h("div", { class: "tp-warn", style: "color:#fbbf24;font-size:11px;margin-top:3px" },
        tr(`⚠️ লোন অ্যাপ লেনদেন (ACTION REQUIRED — স্ক্রিনশট চাইতে হবে): ${a.forbiddenHits.map((x) => x.label).join(", ")}`,
           `⚠️ Loan App Transactions Found (ACTION REQUIRED — request app screenshots): ${a.forbiddenHits.map((x) => x.label).join(", ")}`)));
    }
    const warns = (a.signals || []).filter((s) => s.level === "warn");
    warns.forEach((w) => kids.push(h("div", { class: "tp-err" }, "⚠️ " + w.text)));
    if (!warns.length && (!a.forbiddenHits || !a.forbiddenHits.length)) {
      kids.push(h("div", { style: "color:#4ade80;font-size:11px;margin-top:3px" }, tr("✔ Font ও Balance যাচাই ঠিক আছে", "✔ Font & Balance verification passed")));
    }
    kids.push(pdfPickerButton(st));
    return h("div", { class: "tp-card" }, kids);
  }

  function bpLines(st) {
    return (st.result?.reasons || []).filter((r) => !r.dismissed && r.text).map((r) => r.text);
  }
  const bpMessage = (st) => bpLines(st).map((t, i) => `${i + 1}. ${t}`).join("\n");

  function fillOpinion(text) {
    const tas = Array.from(document.querySelectorAll("textarea"));
    const target = tas.find((ta) => /opinion|remark|reason|comment/i.test(ta.placeholder + ta.id + ta.name)) || tas[0];
    if (!target) { navigator.clipboard.writeText(text); return "Audit Opinion box পাওয়া যায়নি — মেসেজ copy হয়েছে।"; }
    target.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(target, text);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return "Audit Opinion-এ বসানো হয়েছে।";
  }

  function openInWebApp(st) {
    const p = st.lastPayload || Core.buildPayload(st, ui.policy && ui.policy.mrp_factor, st.ignored);
    const json = JSON.stringify({ data: Object.assign({}, p.data, {}), manual: p.manual.map((m) => ({ tid: m.tid, kind: m.kind })) });
    const b = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const localStmt = new URLSearchParams();
    if (st.buyer_name) localStmt.set("stCust", st.buyer_name);
    if (st.guarantor_name) localStmt.set("stGuar", st.guarantor_name);
    if (st.customer_phone) localStmt.set("stCph", Core.normalizePhone(st.customer_phone));
    if (st.guarantor_phone) localStmt.set("stGph", Core.normalizePhone(st.guarantor_phone));
    const rel = st.relation_key || (st.answers && st.answers.guarantor_relation) || Core.mapRelation(st.relation);
    if (rel) localStmt.set("stRel", rel);
    const extra = localStmt.toString() ? "&" + localStmt.toString() : "";
    window.open(ui.cfg.base + "/#case=" + b + extra, "_blank", "noopener");
  }

  function loginView() {
    // keep what the user already typed: the panel re-renders while a scan finishes and used to wipe these boxes
    const draft = loginView.draft || (loginView.draft = { u: "", p: "" });
    const u = h("input", { class: "tp-in", placeholder: "Shared ID", autocomplete: "username", value: draft.u });
    const p = h("input", { class: "tp-in", type: "password", placeholder: "Password", autocomplete: "current-password", value: draft.p });
    u.addEventListener("input", () => { draft.u = u.value; });
    p.addEventListener("input", () => { draft.p = p.value; });
    const base = h("input", { class: "tp-in", value: ui.cfg.base, placeholder: "https://toppay-zeta.vercel.app" });
    const msg = h("div", { class: "tp-err" }, ui.err);
    const go = async () => {
      await send({ type: "setBase", base: base.value });
      const r = await send({ type: "login", username: u.value, password: p.value });
      if (r.ok) {
        draft.u = ""; draft.p = "";
        ui.err = "";
        ui.cfg.loggedIn = true;
        ui.cfg.ok = true;
        await decide();
        scan(true);
      } else {
        ui.err = r.error || "Login হয়নি";
        render();
      }
    };
    p.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return h("div", { class: "tp-card" },
      h("div", { style: "font-weight:700;margin-bottom:6px" }, "TopPay Smart Decision-এ Login"),
      h("div", { class: "tp-muted" }, "Admin যে shared ID/Password দিয়েছেন সেটা দিন। (SOP rule ও BP message server থেকে আসে।)"),
      u, p, h("details", null, h("summary", null, "⚙ Server address"), base), msg,
      h("button", { class: "tp-btn-primary", onclick: go }, "Login"));
  }

  function reasonCard(r) {
    const col = r.kind === "reject" ? "#ef4444" : r.kind === "return" ? "#f59e0b" : "#3b82f6";
    const key = r.id;
    const st = state();
    const kids = [h("div", { style: `font-weight:700;font-size:11px;color:${col}` }, (r.kind === "reject" ? "REJECT" : r.kind === "return" ? "RETURN" : "ACTION") + (r.source === "manual" ? " · extension check" : ""))];
    kids.push(h("div", { class: "tp-msg" }, r.text ?? r.why));
    if (r.source === "auto" && r.text) kids.push(h("div", { class: "tp-why" }, "Rule: " + r.why));
    if (/\{[a-z_0-9]+\}/i.test(r.text || "")) kids.push(h("div", { class: "tp-err" }, tr("⚠️ {…} ফাঁকা আছে — Copy করার পর হাতে লিখে নিন।", "⚠️ {…} placeholder is empty — fill it in manually after copying.")));
    const btns = [];
    if (r.source === "auto") btns.push(h("button", { class: "tp-hbtn", onclick: () => { st.dismissed.add(key); decide(); } }, tr("🚫 বাদ", "🚫 Dismiss")));
    else btns.push(h("button", { class: "tp-hbtn", onclick: () => { const m = (st.lastPayload?.manual || []).find((x) => "manual:" + x.tid === key); if (m) st.ignored.add(m.key); decide(); } }, tr("🚫 বাদ", "🚫 Dismiss")));
    kids.push(h("div", { style: "margin-top:4px" }, btns));
    return h("div", { class: "tp-reason", style: `border-left:3px solid ${col}` }, kids);
  }

  function decisionTab(st) {
    const res = st.result;
    if (!res) return h("div", { class: "tp-card tp-muted" }, ui.scanning ? tr("Scan চলছে…", "Scanning…") : tr("ফলাফল এখনো নেই। ↻ Scan চাপুন।", "No result yet. Click ↻ Scan."));
    const live = res.reasons.filter((r) => !r.dismissed);
    const dismissed = res.reasons.filter((r) => r.dismissed);
    const out = [];
    const relNow = st.relation_key || (st.answers && st.answers.guarantor_relation) || Core.mapRelation(st.relation) || "";
    const validSpouseProof = st.answers && ["marriage_certificate", "child_nid", "qr_birth_certificate"].includes(st.answers.spouse_proof);
    const isSpouseStmt = Boolean(st.stmt_name_mismatch || (st.answers && st.answers.name_mismatch === true));
    if (relNow === "spouse" && isSpouseStmt && !String(st.guar_husband || "").trim() && !validSpouseProof) {
      out.push(h("div", { class: "tp-card", style: "border-color:#dc2626;background:rgba(153,27,27,0.28)" },
        h("div", { class: "tp-err", style: "font-weight:700" }, tr(
          "⚠️ Wife-এর NID-তে স্বামীর নাম নেই: Marriage Certificate অথবা তাদের সন্তানের NID / Birth Certificate চাইতে হবে (সেখানে স্বামী-স্ত্রী উভয়ের নাম আছে কিনা দেখতে হবে)।",
          "⚠️ Husband's name missing on Wife's NID: Request Marriage Certificate or their child's NID / Birth Certificate (verify both parents' names appear)."
        ))));
    }
    const isCustStmt = Boolean((st.stmt_analysis && st.stmt_analysis.holderCheck && st.stmt_analysis.holderCheck.status === "ok_customer") || (st.answers && st.answers.name_mismatch === false && (st.answers.tx_1_month !== undefined || st.answers.tx_3_month !== undefined)));
    if (isCustStmt) {
      out.push(h("div", { class: "tp-card", style: "border-color:#10b981;background:rgba(6,95,70,0.32)" },
        h("div", { style: "color:#6ee7b7;font-weight:700;font-size:12px" }, tr(
          "📞 Customer Statement — Guarantor-কে শুধু Missed Call দিলেই হবে।",
          "📞 Customer Statement — Missed call to Guarantor is enough."
        ))));
    }
    out.push(h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr(`কারণ ও BP মেসেজ (${live.length})`, `Reasons & BP Messages (${live.length})`)),
      live.length ? live.map(reasonCard) : h("div", { class: "tp-muted" }, tr("কোনো reject / return / action নেই।", "No reject / return / action."))));
    const stmtCard = statementSummaryCard(st);
    if (stmtCard) out.push(stmtCard);
    if (res.missing.length) {
      const needTx = res.missing.some(([k]) => k === "tx_1_month" || k === "tx_3_month");
      out.push(h("div", { class: "tp-card", style: "border-color:#d97706" },
        h("div", { style: "font-weight:700;color:#fbbf24;margin-bottom:6px" }, tr(`আরো তথ্য দরকার (${res.missing.length})`, `More Info Needed (${res.missing.length})`)),
        res.missing.map(([k, label]) => widget(st, k, label)),
        needTx && !stmtCard ? pdfPickerButton(st) : null));
    }
    if (st.ignored.size) out.push(h("div", { class: "tp-card tp-muted" }, tr(`Extension-এর ${st.ignored.size}টি যাচাই বাদ দেওয়া আছে। `, `${st.ignored.size} extension check(s) ignored. `), h("button", { class: "tp-hbtn", onclick: () => { st.ignored.clear(); decide(); } }, tr("↩ সব ফিরিয়ে আনুন", "↩ Restore all"))));
    if (dismissed.length) {
      out.push(h("div", { class: "tp-card" }, h("div", { class: "tp-muted" }, tr(`বাদ দেওয়া (${dismissed.length})`, `Dismissed (${dismissed.length})`)),
        dismissed.map((r) => h("div", { class: "tp-muted" }, (r.text || r.why).slice(0, 90),
          h("button", { class: "tp-hbtn", onclick: () => { st.dismissed.delete(r.id); decide(); } }, "↩")))));
    }
    if (res.notes.length) out.push(h("div", { class: "tp-card" }, h("div", { style: "font-weight:700" }, tr("🔒 Internal note (BP-কে বলবেন না)", "🔒 Internal Note (Do not tell BP)")), res.notes.map((n) => h("div", { class: "tp-muted" }, "• " + n))));
    if (res.passed.length) out.push(h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;color:#4ade80" }, tr(`✔ পাস (${res.passed.length})`, `✔ Passed (${res.passed.length})`)), res.passed.map((n) => h("div", { class: "tp-muted" }, "• " + n))));
    out.push(h("details", { class: "tp-card" }, h("summary", null, tr("আরো যাচাই (যা portal থেকে বোঝা যায় না)", "More Checks (Manual / Call Verification)")), MORE.map((k) => widget(st, k))));
    return out;
  }

  function verifyTab(st) {
    const SEL = getSel();
    const row = (a, b, bad, extraBtn) => h("div", { class: "tp-row" },
      h("span", { class: "tp-muted" }, a),
      h("span", { style: "display:inline-flex;align-items:center" },
        h("b", { style: bad ? "color:#f87171" : "" }, b),
        extraBtn || null));
    const resolvedProf = st.profession_key || (st.answers && st.answers.profession) || Core.mapProfession(st.profession);
    const isLandOwner = resolvedProf === "house_owner";
    const phones = [
      ["Shop OSR", st.osr_phone, true],
      ["Customer", st.customer_phone, true],
      ["Guarantor", st.guarantor_phone, true],
      ["Family" + (isLandOwner ? " (Required)" : " (Optional)"), st.family_phone, !resolvedProf || isLandOwner],
      ["Colleague" + (!isLandOwner && resolvedProf ? " (Required)" : " (Optional)"), st.colleague_phone, !resolvedProf || !isLandOwner]
    ];
    const dups = new Set(st.phone_findings.filter((f) => f.key.startsWith("phone:dup")).flatMap((f) => f.key.split(":").slice(2)));
    const keyOf = (l) => l.startsWith("Shop OSR") ? "osr" : l.startsWith("Customer") ? "customer" : l.startsWith("Guarantor") ? "guarantor" : l.startsWith("Family") ? "family" : "colleague";
    const nidTxt = {
      match: tr("✅ মিলেছে", "✅ Matched"),
      mismatch: tr("❌ মেলেনি", "❌ Mismatched"),
      unreadable: tr("⚠️ ছবি থেকে নম্বর পড়া যায়নি — চোখে দেখুন", "⚠️ Unreadable from photo — verify visually"),
      "no-system": tr("System NID পাওয়া যায়নি", "System NID not found"),
      "": st.ocr_running ? tr("পড়া হচ্ছে…", "Reading…") : tr("এখনো পড়া হয়নি", "Not read yet")
    }[st.nid_status];
    const ageTxt = (age, dob) => (age != null ? tr(`${age} বছর (জন্ম ${dob})`, `${age} yrs (DOB ${dob})`) : tr("পাওয়া যায়নি", "Not found"));
    const custNidToCopy = st.nid_no || st.cust_photo_nid || "";
    const guarNidToCopy = st.guar_photo_nid || "";

    const rel = st.relation_key || (st.answers && st.answers.guarantor_relation) || Core.mapRelation(st.relation) || "";
    const stmtMismatch = Boolean(st.stmt_name_mismatch || (st.answers && st.answers.name_mismatch === true));
    const relCheck = (window.TPStmt && rel) ? window.TPStmt.verifyGuarantorRelation({
      relation: rel,
      statementNameMismatch: stmtMismatch,
      customerName: st.buyer_name,
      customerFather: st.cust_father,
      customerMother: st.cust_mother,
      guarantorName: st.guarantor_name,
      guarantorFather: st.guar_father,
      guarantorMother: st.guar_mother,
      guarantorHusband: st.guar_husband,
      spouseProof: st.answers && st.answers.spouse_proof,
    }) : null;

    const imeiRes = Core.checkImei(st.imei, st.box_imei || "");
    const imeiCard = h("div", { class: "tp-card" },
      h("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px" },
        h("div", { style: "font-weight:700" }, tr("📱 IMEI যাচাই (IMEI Check)", "📱 IMEI Verification")),
        st.imei ? copyBtn(st.imei) : null),
      row("System IMEI", st.imei || tr("পাওয়া যায়নি", "Not found"), imeiRes.present && !imeiRes.luhnOk),
      imeiRes.present ? row(tr("১৫-ডিজিট Checksum", "15-Digit Checksum"), imeiRes.luhnOk ? tr("✅ বৈধ (Luhn OK)", "✅ Valid (Luhn OK)") : tr("❌ অবৈধ Checksum", "❌ Invalid Checksum"), !imeiRes.luhnOk) : null,
      imeiRes.tacInfo ? h("div", { class: "tp-muted", style: "margin-bottom:6px" }, `TAC ${imeiRes.tacInfo.tac}: ${imeiRes.tacInfo.brandHint}`) : null,
      h("label", { class: "tp-q" },
        h("span", null, tr("মোবাইল বক্সের IMEI (লিখুন বা বক্সের ছবি বড় করে খুলুন)", "Phone Box IMEI (type or open box photo in preview)")),
        h("input", {
          class: "tp-in",
          placeholder: "15-digit Box IMEI…",
          value: st.box_imei || "",
          oninput: (e) => {
            st.box_imei = e.target.value;
            const chk = Core.checkImei(st.imei, st.box_imei);
            st.imei_box_mismatch = chk.boxMatch === false;
            decideSoon();
          }
        })),
      st.viewer_imei_note ? h("div", { class: "tp-muted", style: "margin-top:4px;color:#93c5fd" }, st.viewer_imei_note) : null,
      (st.box_imeis_found && st.box_imeis_found.length > 1) ? h("div", { style: "display:flex;flex-wrap:wrap;gap:4px;margin-top:4px" },
        st.box_imeis_found.map((im, idx) => h("button", {
          class: "tp-hbtn",
          style: st.box_imei === im ? "background:#0f766e;color:#fff" : "",
          onclick: () => {
            st.box_imei = im;
            const chk = Core.checkImei(st.imei, im);
            st.imei_box_mismatch = chk.boxMatch === false;
            decideSoon();
          }
        }, `IMEI${idx + 1}: ${im}`))) : null,
      st.box_imei ? h("div", { class: imeiRes.boxMatch === false ? (st.imei_box_mismatch ? "tp-err" : "tp-muted") : "tp-muted", style: imeiRes.boxMatch === false && !st.imei_box_mismatch ? "margin-top:4px;color:#fbbf24" : "margin-top:4px" }, imeiRes.summary) : null,
      h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px" },
        h("a", { class: "tp-hbtn", style: "text-decoration:none", href: "https://support.oppo.com/cn/check/", target: "_blank", rel: "noopener" }, "🌐 OPPO Check"),
        h("a", { class: "tp-hbtn", style: "text-decoration:none", href: "https://www.imei.info/", target: "_blank", rel: "noopener" }, "🌐 IMEI.info"),
        h("button", {
          class: "tp-hbtn",
          style: st.imei_photo_missing ? "background:#991b1b;color:#fff" : "",
          onclick: () => { st.imei_photo_missing = !st.imei_photo_missing; decide(); }
        }, st.imei_photo_missing ? tr("✔ adr.08 যোগ হয়েছে", "✔ adr.08 Added") : tr("+ adr.08 (বক্স ছবি নেই)", "+ adr.08 (No Box Photo)")),
        h("button", {
          class: "tp-hbtn",
          style: st.imei_box_mismatch ? "background:#991b1b;color:#fff" : "",
          onclick: () => { st.imei_box_mismatch = !st.imei_box_mismatch; decide(); }
        }, st.imei_box_mismatch ? tr("✔ adr.10 যোগ হয়েছে", "✔ adr.10 Added") : tr("+ adr.10 (IMEI অমিল)", "+ adr.10 (IMEI Mismatch)"))));

    return [
      imeiCard,
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("🪪 দ্রুত Copy (NID ও জন্মতারিখ)", "🪪 Quick Copy (NID & DOB)")),
        row("Customer NID No.", custNidToCopy || "—", false, custNidToCopy ? copyBtn(custNidToCopy) : null),
        row(tr("Customer জন্মতারিখ", "Customer DOB"), st.cust_dob || "—", false, st.cust_dob ? copyBtn(st.cust_dob) : null),
        row("Guarantor NID No.", guarNidToCopy || "—", false, guarNidToCopy ? copyBtn(guarNidToCopy) : null),
        row(tr("Guarantor জন্মতারিখ", "Guarantor DOB"), st.guar_dob || "—", false, st.guar_dob ? copyBtn(st.guar_dob) : null)),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("৫টি ফোন নম্বর", "5 Phone Numbers")),
        phones.map(([l, v, req]) => row(l, Core.isEmptyVal(v) ? (req ? "Empty (Required)" : "Empty (Optional)") : v, (req && Core.isEmptyVal(v)) || dups.has(keyOf(l))))),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("NID বিস্তারিত", "NID Details")),
        row("System NID", st.nid_no || "—"), row(tr("Customer কার্ডের ছবিতে", "Customer Card Photo"), st.cust_photo_nid || "—"), row(tr("Guarantor কার্ডের ছবিতে", "Guarantor Card Photo"), st.guar_photo_nid || "—"),
        row(tr("ফল", "Result"), nidTxt, st.nid_status === "mismatch"),
        row(tr("Customer NID-র পাশ", "Customer NID Sides"), `${st.cust_nid_count}/2`, st.cust_nid_count > 0 && st.cust_nid_count < 2), row(tr("Guarantor NID-র পাশ", "Guarantor NID Sides"), `${st.guar_nid_count}/2`, st.guar_nid_count > 0 && st.guar_nid_count < 2),
        row(tr("Customer বয়স", "Customer Age"), ageTxt(st.customer_age, st.cust_dob)), row(tr("Guarantor বয়স", "Guarantor Age"), ageTxt(st.guarantor_age, st.guar_dob)),
        row(tr("Customer Back QR / MRZ", "Customer Back QR / MRZ"),
          st.cust_qr_data && st.cust_qr_data.found
            ? tr(`✅ ${st.cust_qr_data.format.toUpperCase()} মিলেছে${st.cust_qr_data.nid ? " (" + st.cust_qr_data.nid + ")" : ""}`,
                 `✅ ${st.cust_qr_data.format.toUpperCase()} Scanned${st.cust_qr_data.nid ? " (" + st.cust_qr_data.nid + ")" : ""}`)
            : (st.cust_nid_count >= 2 ? tr("⚠️ QR/MRZ পাওয়া যায়নি", "⚠️ No QR/MRZ detected") : "—"),
          st.cust_qr_front_mismatch),
        row(tr("Guarantor Back QR / MRZ", "Guarantor Back QR / MRZ"),
          st.guar_qr_data && st.guar_qr_data.found
            ? tr(`✅ ${st.guar_qr_data.format.toUpperCase()} মিলেছে${st.guar_qr_data.nid ? " (" + st.guar_qr_data.nid + ")" : ""}`,
                 `✅ ${st.guar_qr_data.format.toUpperCase()} Scanned${st.guar_qr_data.nid ? " (" + st.guar_qr_data.nid + ")" : ""}`)
            : (st.guar_nid_count >= 2 ? tr("⚠️ QR/MRZ পাওয়া যায়নি", "⚠️ No QR/MRZ detected") : "—"),
          st.guar_qr_front_mismatch),
        st.cust_qr_front_mismatch ? h("div", { class: "tp-err" }, tr("⚠️ Customer NID Front ও Back QR নম্বর মেলেনি (qi.25)!", "⚠️ Customer NID Front & Back QR number mismatch (qi.25)!")) : null,
        st.guar_qr_front_mismatch ? h("div", { class: "tp-err" }, tr("⚠️ Guarantor NID Front ও Back QR নম্বর মেলেনি!", "⚠️ Guarantor NID Front & Back QR number mismatch!")) : null,
        ...(st.cust_auth && Array.isArray(st.cust_auth.issues) ? st.cust_auth.issues.map((iss) =>
          h("div", { class: iss.severity === "high" ? "tp-err" : "tp-warn" }, `⚠️ [Customer NID] ${iss.msg}`)
        ) : []),
        ...(st.guar_auth && Array.isArray(st.guar_auth.issues) ? st.guar_auth.issues.map((iss) =>
          h("div", { class: iss.severity === "high" ? "tp-err" : "tp-warn" }, `⚠️ [Guarantor NID] ${iss.msg}`)
        ) : []),
        h("div", { class: "tp-muted", style: "margin-top:6px" }, tr("বয়স NID-র জন্মতারিখ ও পেছনের QR থেকে। OCR ভুল পড়তে পারে — তাই গুরুত্বপূর্ণ হলে ছবি দেখে নিন, অথবা নিচে নিজে বয়স লিখুন।", "Age is computed from NID DOB & Back QR. Verify visually or enter manually below.")),
        h("div", { style: "display:flex;gap:6px;margin-top:6px" },
          h("button", { class: "tp-btn-primary", style: "flex:1;margin-top:0", disabled: st.ocr_running, onclick: () => runOcr(st, true) }, st.ocr_running ? tr("পড়া হচ্ছে…", "Reading…") : tr("↻ NID + Back QR আবার পড়ুন", "↻ Re-read NID + Back QR")))),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("👨‍👩‍👧 সম্পর্ক যাচাই (Father/Mother/Son/Daughter/Brother/Sister/Wife)", "👨‍👩‍👧 Relationship Check (Father/Mother/Son/Daughter/Brother/Sister/Wife)")),
        h("label", { class: "tp-q" }, h("span", null, tr("Guarantor সম্পর্ক", "Guarantor Relation")), h("select", { class: "tp-in", onchange: (e) => { st.relation_key = e.target.value; decideSoon(); } }, h("option", { value: "" }, tr("(স্বয়ংক্রিয়)", "(Auto)")), SEL.guarantor_relation.map(([v, t]) => h("option", { value: v, selected: (st.relation_key || rel) === v }, t)))),
        (rel === "father" || rel === "mother" || rel === "brother" || rel === "sister") ? h("label", { class: "tp-q" }, h("span", null, tr("Customer NID-তে Father/Mother নাম", "Father/Mother Name on Customer NID")), h("input", { class: "tp-in", placeholder: "e.g. Sufia Begum", value: rel === "mother" ? st.cust_mother : st.cust_father, oninput: (e) => { if (rel === "mother") st.cust_mother = e.target.value; else st.cust_father = e.target.value; render(); } })) : null,
        (rel === "brother" || rel === "sister") ? h("label", { class: "tp-q" }, h("span", null, tr("Customer NID-তে Mother নাম", "Mother Name on Customer NID")), h("input", { class: "tp-in", placeholder: tr("Customer-এর মায়ের নাম", "Customer's mother name"), value: st.cust_mother, oninput: (e) => { st.cust_mother = e.target.value; render(); } })) : null,
        (rel === "son" || rel === "daughter" || rel === "brother" || rel === "sister") ? h("label", { class: "tp-q" }, h("span", null, tr("Guarantor NID-তে Father নাম", "Father Name on Guarantor NID")), h("input", { class: "tp-in", placeholder: tr("Guarantor-এর বাবার নাম", "Guarantor's father name"), value: st.guar_father, oninput: (e) => { st.guar_father = e.target.value; render(); } })) : null,
        (rel === "son" || rel === "daughter" || rel === "brother" || rel === "sister") ? h("label", { class: "tp-q" }, h("span", null, tr("Guarantor NID-তে Mother নাম", "Mother Name on Guarantor NID")), h("input", { class: "tp-in", placeholder: tr("Guarantor-এর মায়ের নাম", "Guarantor's mother name"), value: st.guar_mother, oninput: (e) => { st.guar_mother = e.target.value; render(); } })) : null,
        (rel === "spouse") ? [
          h("label", { class: "tp-q" }, h("span", null, tr("Wife-এর NID-তে স্বামীর নাম (থাকলে লিখুন)", "Husband's Name on Wife's NID (if present)")), h("input", { class: "tp-in", placeholder: tr("স্বামীর নাম না থাকলে ফাঁকা রাখুন", "Leave blank if absent"), value: st.guar_husband, oninput: (e) => { st.guar_husband = e.target.value; render(); } })),
          !st.guar_husband ? widget(st, "spouse_proof", tr("Wife প্রমাণ (Marriage Cert / সন্তানের NID বা জন্ম নিবন্ধন)", "Wife Proof (Marriage Cert / Child NID or Birth Cert)")) : null
        ] : null,
        relCheck ? h("div", { class: relCheck.ok === false ? "tp-err" : "tp-muted", style: "margin-top:6px" }, relCheck.text) : null),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700" }, tr("হাতে বয়স লিখুন (OCR না পারলে)", "Enter Age Manually (if OCR fails)")),
        h("label", { class: "tp-q" }, h("span", null, tr("Customer বয়স", "Customer Age")), h("input", { class: "tp-in", type: "number", step: "0.01", value: st.customer_age ?? "", onchange: (e) => { st.customer_age = e.target.value === "" ? null : Number(e.target.value); decideSoon(); } })),
        h("label", { class: "tp-q" }, h("span", null, tr("Guarantor বয়স", "Guarantor Age")), h("input", { class: "tp-in", type: "number", step: "0.01", value: st.guarantor_age ?? "", onchange: (e) => { st.guarantor_age = e.target.value === "" ? null : Number(e.target.value); decideSoon(); } }))),
    ];
  }

  function caseTab(st) {
    const SEL = getSel();
    const f = ui.policy ? ui.policy.mrp_factor : 0.9;
    const row = (a, b) => h("div", { class: "tp-row" }, h("span", { class: "tp-muted" }, a), h("b", null, b || "—"));
    const prof = st.profession_key || Core.mapProfession(st.profession);
    const rel = st.relation_key || Core.mapRelation(st.relation);
    return [
      h("div", { class: "tp-card" },
        row("Order", st.order_no), row("Buyer", st.buyer_name), row("IMEI", st.imei), row("Term", st.term), row("Down payment", st.down_payment_pct ? st.down_payment_pct + "%" : ""),
        row("Total Product Amount", st.total_amount ? st.total_amount.toLocaleString() : ""), row(`MRP (× ${f})`, st.total_amount ? Math.round(st.total_amount * f).toLocaleString() : ""),
        row("Store risk", st.store_risk)),
      h("div", { class: "tp-card" },
        row(tr("Portal-এ পেশা", "Portal Profession"), st.profession), row(tr("→ বোঝা গেছে", "→ Mapped"), prof || tr("বোঝা যায়নি — বেছে নিন", "Unknown — select below")),
        h("label", { class: "tp-q" }, h("span", null, tr("পেশা ঠিক করুন", "Override Profession")), h("select", { class: "tp-in", onchange: (e) => { st.profession_key = e.target.value; decideSoon(); } }, h("option", { value: "" }, tr("(স্বয়ংক্রিয়)", "(Auto)")), SEL.profession.map(([v, t]) => h("option", { value: v, selected: st.profession_key === v }, t)))),
        row(tr("Portal-এ সম্পর্ক", "Portal Relation"), st.relation), row(tr("→ বোঝা গেছে", "→ Mapped"), rel || tr("বোঝা যায়নি", "Unknown")),
        h("label", { class: "tp-q" }, h("span", null, tr("সম্পর্ক ঠিক করুন", "Override Relation")), h("select", { class: "tp-in", onchange: (e) => { st.relation_key = e.target.value; decideSoon(); } }, h("option", { value: "" }, tr("(স্বয়ংক্রিয়)", "(Auto)")), SEL.guarantor_relation.map(([v, t]) => h("option", { value: v, selected: st.relation_key === v }, t))))),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700" }, tr("Attachment তথ্য", "Attachments")),
        row("Work ID", yn(st.has_work_id)), row("Salary slip", yn(st.has_salary_slip)), row("On-site photo", yn(st.has_onsite_photo)), row("Signature", yn(st.has_signature)), row("Face verification", st.face_verify_empty ? "Empty ❌" : tr("আছে/অজানা", "Present/Unknown")),
        pdfPickerButton(st)),
    ];
  }
  const yn = (v) => (v === true ? tr("আছে ✔", "Yes ✔") : v === false ? tr("নেই ❌", "No ❌") : "—");

  function flagsTab(st) {
    return [
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("আগের Audit Opinion", "Previous Audit Opinion")), st.audit_history.length ? st.audit_history.map((x) => h("div", { class: "tp-muted" }, "• " + x)) : h("div", { class: "tp-muted" }, tr("নেই", "None"))),
      h("div", { class: "tp-card" }, h("div", { style: "font-weight:700;margin-bottom:4px" }, tr("Extension-এর নিজের যাচাই", "Extension Built-in Checks")),
        st.phone_findings.length ? st.phone_findings.map((f) => h("div", { class: "tp-muted" }, (f.kind === "return" ? "↩ " : "ℹ️ ") + f.title)) : h("div", { class: "tp-muted" }, tr("ফোন নম্বরে সমস্যা নেই।", "No phone number issues found.")),
        st.face_verify_empty ? h("div", { class: "tp-muted" }, tr("ℹ️ Face Verification Photo খালি — দরকার হলে 'adr.09' manual reason দিন।", "ℹ️ Face Verification Photo is empty — add 'adr.09' manually if needed.")) : null),
    ];
  }

  function applySavedPos(el, pos) {
    if (!pos || typeof pos.left !== "number" || typeof pos.top !== "number") return;
    const maxL = Math.max(4, window.innerWidth - Math.min(el.offsetWidth || 390, window.innerWidth - 8));
    const maxT = Math.max(4, window.innerHeight - 48);
    el.style.left = Math.min(Math.max(4, pos.left), maxL) + "px";
    el.style.top = Math.min(Math.max(4, pos.top), maxT) + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function movable(el, handle, storageKey, stateProp, onClickOnly) {
    if (handle.dataset.tpDragBound === "1") return;
    handle.dataset.tpDragBound = "1";
    let sx = 0, sy = 0, ox = 0, oy = 0, down = false, moved = false;
    const start = (cx, cy) => {
      const rect = el.getBoundingClientRect();
      down = true;
      moved = false;
      sx = cx;
      sy = cy;
      ox = rect.left;
      oy = rect.top;
    };
    const move = (cx, cy) => {
      if (!down) return;
      const dx = cx - sx, dy = cy - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      const w = el.offsetWidth || 60;
      const maxL = Math.max(4, window.innerWidth - Math.min(w, window.innerWidth - 8));
      const maxT = Math.max(4, window.innerHeight - 40);
      const nl = Math.min(Math.max(4, ox + dx), maxL);
      const nt = Math.min(Math.max(4, oy + dy), maxT);
      el.style.left = nl + "px";
      el.style.top = nt + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      if (stateProp) ui[stateProp] = { left: nl, top: nt };
    };
    const end = () => {
      if (!down) return;
      down = false;
      if (moved && storageKey && ui[stateProp]) {
        try { localStorage.setItem(storageKey, JSON.stringify(ui[stateProp])); } catch {}
      } else if (!moved && typeof onClickOnly === "function") {
        onClickOnly();
      }
    };
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      start(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    document.addEventListener("mouseup", end);
    handle.addEventListener("touchstart", (e) => {
      if (e.target.closest("button") || !e.touches[0]) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (down && e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener("touchend", end);
  }

  function fab() {
    if (!document.body) return;
    let btn = document.getElementById("tp-fab");
    if (!btn) {
      btn = h("div", { id: "tp-fab", title: "TopPay Smart Decision (Drag anywhere)" }, "⚡ TP");
      document.body.appendChild(btn);
    }
    applySavedPos(btn, ui.fabPos);
    movable(btn, btn, "tp_ext_fab_pos", "fabPos", () => {
      ui.open = !ui.open;
      render();
      if (ui.open && isDetailPage()) scan(false);
    });
  }

  function langPopupOverlay() {
    if (ui.langChosen) return null;
    return h("div", { class: "tp-lang-overlay" },
      h("div", { class: "tp-lang-box" },
        h("div", { style: "font-size:15px;font-weight:800;color:#fff" }, "🌐 ভাষা নির্বাচন করুন / Choose Language"),
        h("div", { class: "tp-muted", style: "margin-top:6px;color:#cbd5e1" },
          "Extension-এর সব লেখা কোন ভাষায় দেখতে চান? পরে হেডারের বাটন থেকেও বদলাতে পারবেন।"),
        h("div", { class: "tp-lang-grid" },
          h("button", { class: "tp-lang-choice", onclick: () => setLang("bn") }, "🇧🇩 বাংলা (Bangla)"),
          h("button", { class: "tp-lang-choice", onclick: () => setLang("en") }, "🇬🇧 English"))));
  }

  function render() {
    if (!document.body) return;
    fab();
    let panel = document.getElementById("tp-smart-panel");
    if (!ui.open) { if (panel) panel.style.display = "none"; return; }
    if (!panel) { panel = h("div", { id: "tp-smart-panel" }); document.body.appendChild(panel); }
    panel.style.display = "flex";
    applySavedPos(panel, ui.pos);
    const bodyOld = panel.querySelector(".tp-body");
    const scrollTop = bodyOld ? bodyOld.scrollTop : 0;
    const st = state();
    const onDetail = isDetailPage() || !!(st.buyer_name || st.nid_no || st.order_no);
    const res = st.result;
    const [col, bg] = res ? (STATUS_STYLE[res.status] || ["#94a3b8", "#142338"]) : ["#94a3b8", "#142338"];
    const header = h("div", { class: "tp-header", id: "tp-drag", title: tr("ধরে স্ক্রিনের যেকোনো জায়গায় সরান", "Drag to move anywhere on screen") },
      h("div", { style: "display:flex;align-items:center;gap:5px" }, h("span", { style: "color:#facc15" }, "⚡"), h("strong", { style: "font-size:12px;color:#fff" }, "TopPay Smart Decision"), h("span", { class: "tp-badge-sop" }, "v" + chrome.runtime.getManifest().version)),
      h("div", { style: "display:flex;gap:4px" },
        h("button", { class: "tp-hbtn", title: tr("Switch to English", "বাংলায় দেখুন"), onclick: () => setLang(isEn() ? "bn" : "en") }, isEn() ? "🌐 বাংলা" : "🌐 EN"),
        h("button", { class: "tp-hbtn", onclick: () => scan(true) }, ui.scanning ? tr("Scanning…", "Scanning…") : "↻ Scan"),
        h("button", { class: "tp-hbtn", title: tr("Reset & Sync Rules", "Reset & Sync Rules"), onclick: async () => { delete cache[orderIdFromUrl()]; ui.scanning = false; ensureRulesBundle(true).catch(() => {}); scan(true); } }, "Reset"),
        h("button", { class: "tp-hbtn", onclick: () => { ui.cfg.loggedIn = false; send({ type: "logout" }); render(); } }, "⚙"),
        h("button", { class: "tp-hbtn", onclick: () => { ui.open = false; render(); } }, "✕")));
    const sub = h("div", { style: "padding:6px 12px;background:#09111e;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8" },
      h("span", null, "Order: ", h("b", { style: "color:#e2e8f0" }, st.order_no || "—")),
      h("span", null, "Buyer: ", h("b", { style: "color:#e2e8f0" }, st.buyer_name || "—")),
      h("span", null, "IMEI: ", h("b", { style: "color:#e2e8f0" }, st.imei || "—")));
    const banner = h("div", { class: "tp-status", style: `background:${bg};color:${col};border-color:${col}33` },
      h("div", null, h("div", { style: "font-weight:800;font-size:14px" }, res ? res.status : (ui.cfg.loggedIn ? (ui.scanning ? "SCANNING…" : "READY") : "LOGIN NEEDED")),
        res && res.fast_track ? h("div", { style: "font-size:11px;color:#fde68a" }, tr("⚡ Fast-Track (Guarantor-কে শুধু ২টি প্রশ্ন)", "⚡ Fast-Track (2-question guarantor check)")) : null),
      h("div", { style: "display:flex;gap:5px" },
        h("button", { class: "tp-hbtn", onclick: (e) => { navigator.clipboard.writeText(bpMessage(st) || "Approved"); e.target.textContent = "✅ Copied"; setTimeout(() => (e.target.textContent = "📋 BP Msg"), 1400); } }, "📋 BP Msg"),
        h("button", { class: "tp-hbtn", style: "background:#2563eb", onclick: (e) => { e.target.textContent = fillOpinion(bpMessage(st) || "Approved").slice(0, 14) + "…"; setTimeout(() => (e.target.textContent = "✍️ Fill"), 1800); } }, "✍️ Fill")));
    const tabs = h("div", { class: "tp-tabs" }, ["Decision", "Verify & NID", "Case Data", "Flags & History"].map((t) => h("button", { class: "tp-tab-btn" + (ui.tab === t ? " active" : ""), onclick: () => { ui.tab = t; render(); } }, t)));
    let content;
    if (!ui.cfg.loggedIn) content = loginView();
    else if (!onDetail) content = h("div", { class: "tp-card tp-muted" }, tr("Audit detail page (/useraudit/detail/…) খুলুন।", "Open an audit detail page (/useraudit/detail/…)."));
    else content = [ui.err ? h("div", { class: "tp-err" }, ui.err) : null, ui.stmtNote ? h("div", { class: "tp-muted" }, ui.stmtNote) : null, ui.ocrNote ? h("div", { class: "tp-muted" }, ui.ocrNote) : null,
      ui.tab === "Decision" ? decisionTab(st) : ui.tab === "Verify & NID" ? verifyTab(st) : ui.tab === "Case Data" ? caseTab(st) : flagsTab(st)];
    const body = h("div", { class: "tp-body" }, content);
    const foot = ui.cfg.loggedIn && onDetail ? h("div", { class: "tp-foot" }, h("button", { class: "tp-hbtn", onclick: () => openInWebApp(st) }, tr("🌐 পুরো Checker-এ খুলুন", "🌐 Open Full Checker")),
      h("span", { class: "tp-muted" }, tr("নাম/ফোন/NID কখনো server-এ যায় না", "Name/Phone/NID never leave your PC"))) : null;
    const overlay = langPopupOverlay();
    panel.replaceChildren(header, sub, banner, tabs, body, foot || "", overlay || "");
    body.scrollTop = scrollTop;
    movable(panel, header, "tp_ext_pos", "pos", null);
  }

  let lastViewerSrc = "";
  setInterval(async () => {
    const viewerImg = document.querySelector(".el-image-viewer__img");
    if (!viewerImg) { lastViewerSrc = ""; return; }
    if (!viewerImg.src || viewerImg.src === lastViewerSrc) return;
    lastViewerSrc = viewerImg.src;
    const st = state();
    ui.ocrNote = "বড় প্রিভিউ ছবি (IMEI / NID) পড়া হচ্ছে…";
    st.viewer_imei_note = "📸 প্রিভিউ ছবি থেকে IMEI খোঁজা হচ্ছে…";
    render();
    const r = await ocr(viewerImg.src, st.imei || st.nid_no, true, "viewer");
    ui.ocrNote = "";
    if (r && r.texts) {
      const imeis = Core.parseImeiTexts(r.texts);
      if (imeis.length) {
        st.box_imeis_found = imeis;
        const sysDigits = Core.digitsOf(st.imei);
        const matchedImei = sysDigits ? imeis.find((x) => x === sysDigits) : null;
        if (matchedImei) {
          st.box_imei = matchedImei;
          st.imei_box_mismatch = false;
          st.viewer_imei_note = `✅ ছবি থেকে System IMEI মিলেছে: ${matchedImei}${imeis.length > 1 ? ` (সব: ${imeis.join(", ")})` : ""}`;
        } else {
          st.box_imei = imeis[0];
          st.viewer_imei_note = `⚠️ ছবি থেকে পাওয়া IMEI (${imeis.join(", ")}) সিস্টেমের সাথে মেলেনি — ডুয়াল-সিম বক্সে অন্য IMEI হতে পারে, চোখে দেখে নিশ্চিত হলে '+ adr.10' চাপুন।`;
        }
      } else {
        st.viewer_imei_note = "📸 প্রিভিউ ছবিতে ১৫-ডিজিট IMEI পাওয়া যায়নি (NID/অন্য ছবি হতে পারে)।";
      }
      const stripUrl = (u) => String(u || "").split("?")[0].split("#")[0];
      const vBase = stripUrl(viewerImg.src);
      const isCustImg = st.cust_nid_urls.some((u) => stripUrl(u) === vBase);
      const isGuarImg = st.guar_nid_urls.some((u) => stripUrl(u) === vBase);
      const parsed = Core.parseNidTexts(r.texts);

      let matchedCust = isCustImg;
      let matchedGuar = isGuarImg;
      if (parsed.numbers.length) {
        const hitCust = st.nid_no ? parsed.numbers.find((n) => Core.nidNumbersMatch(n, st.nid_no)) : null;
        const hitGuar = st.guar_photo_nid ? parsed.numbers.find((n) => Core.nidNumbersMatch(n, st.guar_photo_nid)) : null;
        if (hitCust) {
          matchedCust = true;
          st.cust_photo_nid = hitCust;
          st.nid_mismatch = false;
          st.nid_status = "match";
        } else if (hitGuar) {
          matchedGuar = true;
          st.guar_photo_nid = hitGuar;
        } else if (!matchedCust && !matchedGuar) {
          if (!st.cust_photo_nid) { matchedCust = true; st.cust_photo_nid = parsed.numbers[0]; }
          else if (!st.guar_photo_nid && parsed.numbers[0] !== st.cust_photo_nid) { matchedGuar = true; st.guar_photo_nid = parsed.numbers[0]; }
        }
      }
      if (parsed.dob) {
        const ageObj = Core.ageFromIso(parsed.dob.iso);
        if (matchedGuar && !matchedCust) {
          st.guar_dob = parsed.dob.iso;
          if (ageObj) st.guarantor_age = ageObj.decimal;
        } else if (matchedCust && !matchedGuar) {
          st.cust_dob = parsed.dob.iso;
          if (ageObj) st.customer_age = ageObj.decimal;
        } else if (!st.cust_dob) {
          st.cust_dob = parsed.dob.iso;
          if (ageObj) st.customer_age = ageObj.decimal;
        } else if (parsed.dob.iso !== st.cust_dob) {
          st.guar_dob = parsed.dob.iso;
          if (ageObj) st.guarantor_age = ageObj.decimal;
        }
      }
      await decide();
    } else {
      st.viewer_imei_note = r && r.error ? `⚠️ প্রিভিউ OCR ত্রুটি: ${r.error}` : "";
      render();
    }
  }, 900);

  let activeDetailObs = null;
  let readyDebounceTimer = null;
  function waitForDetailContentAndScan() {
    if (activeDetailObs) { activeDetailObs.disconnect(); activeDetailObs = null; }
    if (readyDebounceTimer) { clearTimeout(readyDebounceTimer); readyDebounceTimer = null; }
    if (!isDetailPage()) return;

    const isPageFullyReady = () => {
      const t = document.body ? (document.body.innerText || "") : "";
      const hasHeader = /Order No\./i.test(t) && /Buyer\s*\/\s*Receiver|IMEI/i.test(t);
      const { uniqueTabs } = getPortalTabs();
      return hasHeader && uniqueTabs.length >= 2;
    };

    let fullAutoScanStarted = false;
    const scheduleFullScan = (delayMs) => {
      if (readyDebounceTimer) clearTimeout(readyDebounceTimer);
      readyDebounceTimer = setTimeout(() => {
        if (!isDetailPage()) return;
        const st = state();
        if (!fullAutoScanStarted || !st.order_no || !st.nid_no || !st.customer_phone) {
          fullAutoScanStarted = true;
          scan(false);
        }
      }, delayMs);
    };

    if (isPageFullyReady()) {
      scheduleFullScan(320);
    }

    const obs = new MutationObserver(() => {
      if (!isDetailPage()) { obs.disconnect(); return; }
      const st = state();
      if (isPageFullyReady()) {
        if (!fullAutoScanStarted) {
          scheduleFullScan(350);
        } else if (st.order_no && st.nid_no && st.customer_phone) {
          obs.disconnect();
          if (activeDetailObs === obs) activeDetailObs = null;
        }
      }
    });
    activeDetailObs = obs;
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });

    // Safety fallbacks in case portal API loads slowly
    setTimeout(() => {
      if (isDetailPage() && !fullAutoScanStarted) {
        fullAutoScanStarted = true;
        scan(false);
      }
    }, 1800);
    setTimeout(() => {
      if (activeDetailObs === obs) { obs.disconnect(); activeDetailObs = null; }
    }, 22000);
  }

  async function init() {
    // 1. Ask injected.js (MAIN world) to replay any early API responses/PDFs captured before document_idle
    try { window.postMessage({ source: "TOPPAY_CONTENT_READY" }, "*"); } catch {}
    // 2. Pre-warm OCR iframe + Tesseract worker in background immediately
    ocrFrame().then((f) => { try { f.contentWindow.postMessage({ type: "warmup" }, "*"); } catch {} }).catch(() => {});
    // 3. Render immediately and load auth config without blocking on remote network!
    render();
    const cfg = await send({ type: "cfg" });
    if (cfg && (cfg.ok || cfg.base)) ui.cfg = cfg;
    if (ui.cfg.loggedIn) ensureRulesBundle(false).catch(() => {});
    render();
    waitForDetailContentAndScan();
  }

  let lastUrl = location.href;
  const onRouteChange = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    scanGen++;
    ui.scanning = false;
    if (isDetailPage()) {
      render();
      waitForDetailContentAndScan();
    } else {
      render();
    }
  };
  try {
    const origPush = history.pushState;
    const origRep = history.replaceState;
    history.pushState = function (...a) { const r = origPush.apply(this, a); setTimeout(onRouteChange, 30); return r; };
    history.replaceState = function (...a) { const r = origRep.apply(this, a); setTimeout(onRouteChange, 30); return r; };
    window.addEventListener("popstate", () => setTimeout(onRouteChange, 30));
    window.addEventListener("hashchange", () => setTimeout(onRouteChange, 30));
  } catch {}
  setInterval(onRouteChange, 250);

  if (document.readyState === "complete" || document.readyState === "interactive") init();
  else window.addEventListener("DOMContentLoaded", init);
})();
