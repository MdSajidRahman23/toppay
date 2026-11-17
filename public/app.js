"use strict";
/* TopPay Smart Decision Assistant - browser side.
   Talks to the stable /api (see API.md). Nothing about a customer is stored on the server;
   notes, local template edits and the case history live only in this browser (localStorage). */

const $ = (id) => document.getElementById(id);
const form = $("form");

const PROFESSIONS = [
  ["job_holder", "চাকরিজীবী (Job holder)"], ["student", "ছাত্র/ছাত্রী (Student)"],
  ["businessman", "ব্যবসায়ী (Businessman)"], ["rider", "Rider"],
  ["house_owner", "House owner (বাড়িওয়ালা)"], ["unemployed", "বেকার / কিছুই করে না"], ["other", "অন্যান্য"],
  ["media_press", "Media / Press"], ["ngo_loan", "Loan-দানকারী NGO কর্মী"],
  ["competitor", "প্রতিযোগী / অন্য mobile installment কর্মী"],
  ["defense", "Defense / Police / Military"], ["lawyer", "Lawyer"],
  ["disabled", "প্রতিবন্ধী ব্যক্তি"],
];

const STATUS_CLASS = {
  "APPROVED": "approved", "ACTION REQUIRED": "action", "RETURNED": "returned",
  "REJECTED / SUSPECTED FRAUD": "rejected", "MORE INFO NEEDED": "need",
};
const STATUS_ICON = { approved: "✅", action: "⚠️", returned: "↩️", rejected: "⛔", need: "❓" };

// ------------------------------------------------------------ safe storage helpers
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// ------------------------------------------------------------ login / session
const TOKEN_KEY = "tp_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

function showLogin(msg) {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("lerr").classList.toggle("hidden", !msg);
  $("lerr").textContent = msg || "";
}
function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  ensureLib();
  loadPolicy();
  renderHistory();
}
// fetch with the login token; a 401 sends the user back to the login screen
async function authFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + (getToken() || "") });
  const r = await fetch(url, Object.assign({}, opts, { headers }));
  if (r.status === 401) { setToken(null); showLogin("Session শেষ। আবার Login করুন।"); throw new Error("Login দরকার"); }
  return r;
}
async function api(url, method = "GET", body) {
  const r = await authFetch(url, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof out.detail === "string" ? out.detail : "তথ্য ঠিক নেই");
  return out;
}

// ------------------------------------------------------------ clipboard
async function copyText(text, btn, done = "✅ Copy হয়েছে") {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = done; }
  catch { btn.textContent = "Copy করা গেল না"; }
  setTimeout(() => { btn.textContent = old; }, 1400);
}

// ---- profession dropdowns
document.querySelectorAll("select[data-prof]").forEach((sel) => {
  sel.innerHTML = '<option value="">—</option>' +
    PROFESSIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
});

// ---- show only the fields that matter for this case
function val(name) { return form.elements[name].value; }
function checked(name) { return form.elements[name].checked; }

function updateVisibility() {
  const prof = val("profession");
  const mrp = Number(val("mrp")) || 0;
  const flags = {
    jobstu: prof === "job_holder" || prof === "student",
    biz: prof === "businessman",
    house: prof === "house_owner",
    mismatch: checked("name_mismatch"),
    spouse: checked("name_mismatch") && val("guarantor_relation") === "spouse",
    slip: checked("salary_slip_submitted"),
  };
  document.querySelectorAll("[data-show]").forEach((el) => {
    el.classList.toggle("hidden", !flags[el.dataset.show]);
  });
  const hint = $("docHint");
  if (!prof) hint.textContent = "পেশা বেছে নিলে প্রাসঙ্গিক ঘর এখানে আসবে।";
  else if (mrp && mrp < 50000) hint.textContent = "MRP ৫০,০০০-এর নিচে: সাধারণ নিয়ম প্রযোজ্য, বাড়তি ডকুমেন্ট লাগবে না।";
  else hint.textContent = "";
}

// ------------------------------------------------ date of birth -> age (decimal years)
const toBn = (n) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[d]);

function dhakaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: g("year"), m: g("month"), d: g("day") };
}

// returns {years, months, decimal} or null when the date is not valid / in the future
function ageFromDob(d, m, y) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const t = dhakaToday();
  let months = (t.y - y) * 12 + (t.m - m);
  if (t.d < d) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12, decimal: Math.round((months / 12) * 100) / 100 };
}

document.querySelectorAll(".dob").forEach((box) => {
  const cal = box.querySelector(".dob-cal");
  if (cal) {
    const t = dhakaToday();
    cal.max = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    cal.addEventListener("input", () => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cal.value);
      if (!m) return;
      box.querySelector(".dob-y").value = Number(m[1]);
      box.querySelector(".dob-m").value = Number(m[2]);
      box.querySelector(".dob-d").value = Number(m[3]);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  box.addEventListener("input", () => {
    const [d, m, y] = [".dob-d", ".dob-m", ".dob-y"].map((c) => Number(box.querySelector(c).value));
    const hint = box.parentElement.querySelector(".agehint");
    const ageInput = form.elements[box.dataset.age];
    if (!d && !m && !y) { hint.textContent = ""; return; }
    if (!d || !m || !y) { hint.textContent = "দিন, মাস ও সাল তিনটাই লিখুন।"; return; }
    const a = ageFromDob(d, m, y);
    if (!a) { hint.textContent = "⚠️ তারিখটা ঠিক নেই।"; return; }
    ageInput.value = a.decimal;
    hint.textContent = `✔ বয়স: ${toBn(a.years)} বছর ${toBn(a.months)} মাস`;
  });
});

// ---- read the form (hidden fields are ignored so old values can't leak in)
function collect() {
  const data = {};
  Array.from(form.elements).forEach((el) => {
    if (!el.name) return;
    const hidden = el.closest("[data-show]")?.classList.contains("hidden");
    if (hidden) { data[el.name] = null; return; }
    if (el.type === "checkbox") { data[el.name] = el.checked ? true : null; return; }
    if (el.value === "") { data[el.name] = null; return; }
    data[el.name] = el.type === "number" ? Number(el.value) : el.value;
  });
  if (data.no_original_nid) data.has_original_nid = false;
  delete data.no_original_nid;
  return data;
}

function fillForm(data) {
  Array.from(form.elements).forEach((el) => {
    if (!el.name) return;
    let v = data[el.name];
    if (el.name === "no_original_nid") v = data.has_original_nid === false ? true : null;
    if (el.type === "checkbox") el.checked = v === true;
    else el.value = v === null || v === undefined ? "" : String(v);
  });
  document.querySelectorAll(".dob input").forEach((i) => { i.value = ""; });
  document.querySelectorAll(".agehint").forEach((h) => { h.textContent = ""; });
  $("totalAmt").value = "";
}

// ============================================================ template text: layers + placeholders
// built-in < global (admin, from the server) < local (this PC only, localStorage). Local text NEVER goes to the server.
const LOCAL_KEY = "tp_local_tpl";
let LOCAL = lsGet(LOCAL_KEY, {}) || {};   // id -> {text, base, at}   base = the global text when the edit was made
let LIB = null, LIB_BY_ID = {}, ROLE = "user", ME = null;
let activeSection = "all";
let POLICY = null;   // numbers the admin can edit (GET /api/policy)
async function loadPolicy() { try { POLICY = await api("/api/policy"); } catch { /* keep defaults */ } return POLICY; }
const pv = (k, d) => (POLICY && POLICY.values && POLICY.values[k] !== undefined ? POLICY.values[k] : d);
let LAST_CTX = null;

const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// same values the server computes (used only when the server list is not loaded yet)
function localContext() {
  const m = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", month: "numeric" }).format(new Date())) - 1;
  const idx = [3, 2, 1].map((k) => ((m - k) % 12 + 12) % 12);
  return {
    m3: idx.map((i) => EN_MONTHS[i]).join(", "), m3_bn: idx.map((i) => BN_MONTHS[i]).join(", "),
    m3_bn_sp: idx.map((i) => BN_MONTHS[i]).join(" "), m1_bn: BN_MONTHS[idx[0]], m1: EN_MONTHS[idx[0]],
  };
}
const ctx = () => (LIB && LIB.context) || LAST_CTX || localContext();

const PH_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
function placeholdersOf(text) { return [...new Set([...(text || "").matchAll(PH_RE)].map((m) => m[1]))]; }
// known placeholders are filled, unknown ones stay as {name} (the reviewer types them in the result card)
function renderTpl(text, params) {
  const vals = Object.assign({}, ctx(), params || {});
  return (text || "").replace(PH_RE, (all, k) => (k in vals ? String(vals[k]) : all));
}
const hasBangla = (t) => /[ঀ-৿]/.test(t);
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }) : "");

const rawText = (it) => (LOCAL[it.id] ? LOCAL[it.id].text : it.text);
const shownText = (it) => renderTpl(rawText(it));

// ============================================================ result: many reasons in one case
let manual = [];                 // [{tid, kind}]  reasons the reviewer added by hand
const dismissed = new Set();     // keys of automatic reasons the reviewer switched off
let FILLS = {};                  // reason id -> {placeholder: typed value}   (browser only)
let CURRENT = null;              // last server answer

function addTag(parent, cls, text) {
  const s = document.createElement("span");
  s.className = "tag " + cls;
  s.textContent = text;
  parent.appendChild(s);
}
function mkBtn(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

// BP-facing text of one reason: this PC's own edit (if any) > the server text (global/built-in), placeholders + typed values filled
function reasonFinal(r) {
  if (!r.tid || r.text === null || r.text === undefined) return { text: null, open: [] };
  const l = LOCAL[r.tid];
  let t = l ? renderTpl(l.text, r.params) : r.text;
  const fills = FILLS[r.id] || {};
  t = t.replace(PH_RE, (all, k) => (fills[k] ? fills[k] : all));
  return { text: t, open: placeholdersOf(t) };
}

function reasonCard(r) {
  const li = document.createElement("li");
  if (r.dismissed) li.className = "isdismissed";
  const fin = reasonFinal(r);
  const head = document.createElement("div");
  head.textContent = fin.text !== null ? "" : r.why;
  if (fin.text !== null) {
    const lab = document.createElement("div");
    lab.className = "bplabel";
    lab.textContent = r.kind === "reject" ? "Reject reason (English)" : "BP-কে পাঠানোর মেসেজ";
    if (r.source === "manual") addTag(lab, "manual", "manual");
    if (r.tid && LOCAL[r.tid]) addTag(lab, "pc", "আপনার PC-র edit");
    li.appendChild(lab);
    const box = document.createElement("div");
    box.className = "msgbox";
    box.textContent = fin.text;
    li.appendChild(box);
    if (r.source === "auto") {
      const why = document.createElement("div");
      why.className = "rule";
      const b = document.createElement("b");
      b.textContent = "Rule: ";
      why.appendChild(b);
      why.appendChild(document.createTextNode(r.why));
      li.appendChild(why);
    }
    // placeholders nobody can know (e.g. the statement holder's name): small boxes, filled here only
    const unknown = placeholdersOf(l_or(r)).filter((k) => !(k in Object.assign({}, ctx(), r.params || {})));
    if (unknown.length) {
      const wrap = document.createElement("div");
      wrap.className = "fills";
      unknown.forEach((k) => {
        const lb = document.createElement("label");
        lb.textContent = `{${k}} লিখুন`;
        const inp = document.createElement("input");
        inp.type = "text"; inp.maxLength = 120; inp.value = (FILLS[r.id] || {})[k] || "";
        inp.addEventListener("input", () => {
          FILLS[r.id] = Object.assign(FILLS[r.id] || {}, { [k]: inp.value.trim() });
          box.textContent = reasonFinal(r).text;
        });
        lb.appendChild(inp);
        wrap.appendChild(lb);
      });
      li.appendChild(wrap);
    }
    const row = document.createElement("div");
    row.className = "rbtns";
    const cb = mkBtn(r.kind === "reject" ? "📋 Reject reason copy" : "📋 BP-র মেসেজ copy", "mini", () => copyText(reasonFinal(r).text, cb));
    row.appendChild(cb);
    addRowButtons(row, r);
    li.appendChild(row);
  } else {                    // internal instruction for the reviewer (no BP message)
    if (r.source === "auto") {
      head.textContent = r.why;
      li.appendChild(head);
    }
    const row = document.createElement("div");
    row.className = "rbtns";
    addRowButtons(row, r);
    if (row.children.length) li.appendChild(row);
  }
  return li;
}
function l_or(r) { return LOCAL[r.tid] ? LOCAL[r.tid].text : (r.template || ""); }

function addRowButtons(row, r) {
  if (r.source === "manual") {
    row.appendChild(mkBtn("✖ সরান", "mini danger", () => {
      manual = manual.filter((m) => "manual:" + m.tid !== r.id);
      renderPicker(); evaluate();
    }));
  } else if (!r.dismissed) {
    row.appendChild(mkBtn("🚫 বাদ দিন", "mini ghostbtn", () => { dismissed.add(r.id); evaluate(); }));
  }
}

function fillGroup(id, boxId, list) {
  const ul = $(id);
  ul.innerHTML = "";
  list.forEach((r) => ul.appendChild(reasonCard(r)));
  $(boxId).classList.toggle("hidden", list.length === 0);
}

function fillDismissed(list) {
  const ul = $("dismissed");
  ul.innerHTML = "";
  list.forEach((r) => {
    const li = document.createElement("li");
    const t = document.createElement("div");
    t.textContent = reasonFinal(r).text || r.why;
    addTag(t, "was", r.kind);
    li.appendChild(t);
    const row = document.createElement("div");
    row.className = "rbtns";
    row.appendChild(mkBtn("↩ ফিরিয়ে আনুন", "mini", () => { dismissed.delete(r.id); evaluate(); }));
    li.appendChild(row);
    ul.appendChild(li);
  });
  $("dismissedBox").classList.toggle("hidden", list.length === 0);
}

function fillStrings(id, items) {
  const ul = $(id);
  ul.innerHTML = "";
  items.forEach((s) => { const li = document.createElement("li"); li.textContent = s; ul.appendChild(li); });
}

function render(res) {
  CURRENT = res;
  LAST_CTX = res.context || LAST_CTX;
  $("empty").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("err").classList.add("hidden");

  const cls = STATUS_CLASS[res.status] || "need";
  $("badge").className = "badge " + cls;
  $("badge").textContent = `${STATUS_ICON[cls]} ${res.status}`;

  $("fast").classList.toggle("hidden", !res.fast_track);
  $("fast").textContent = res.fast_track ? "🔒 Internal · " + res.fast_track_msg : "";

  const live = res.reasons.filter((r) => !r.dismissed);
  fillStrings("missing", res.missing.map((m) => m[1]));
  $("missingBox").classList.toggle("hidden", res.missing.length === 0);
  fillGroup("rejects", "rejectsBox", live.filter((r) => r.kind === "reject"));
  fillGroup("returns", "returnsBox", live.filter((r) => r.kind === "return"));
  fillGroup("actions", "actionsBox", live.filter((r) => r.kind === "action"));
  fillDismissed(res.reasons.filter((r) => r.dismissed));
  fillStrings("passed", res.passed);
  fillStrings("notes", res.notes);
  $("internalBox").classList.toggle("hidden", res.notes.length === 0 && !res.fast_track);
  updateCopyNote();
}

// numbered list of BP-facing text only (never the internal notes), in the order the reviewer picked
function bpLines() {
  if (!CURRENT) return [];
  const order = $("copyOrder").value;
  let list = CURRENT.reasons.filter((r) => !r.dismissed && reasonFinal(r).text !== null);
  const rank = (r) => ({ reject: 0, return: 1, action: 2 }[r.kind]);
  if (order === "severity") list = list.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  else if (order === "return_first") list = list.map((r, i) => [r, i]).sort((a, b) => ({ return: 0, action: 1, reject: 2 }[a[0].kind] - { return: 0, action: 1, reject: 2 }[b[0].kind]) || a[1] - b[1]).map((x) => x[0]);
  else if (order === "manual_first") list = list.map((r, i) => [r, i]).sort((a, b) => (a[0].source === "manual" ? 0 : 1) - (b[0].source === "manual" ? 0 : 1) || a[1] - b[1]).map((x) => x[0]);
  return list.map((r) => reasonFinal(r));
}
function updateCopyNote() {
  const lines = bpLines();
  const open = lines.filter((l) => l.open.length).length;
  $("copyNote").textContent = lines.length
    ? `${lines.length}টি reason copy হবে${open ? ` · ⚠️ ${open}টিতে {…} ফাঁকা আছে` : ""}।`
    : "BP-কে পাঠানোর মতো কোনো মেসেজ নেই।";
  $("copy").disabled = lines.length === 0;
}

function showEmpty() {
  CURRENT = null;
  $("empty").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("err").classList.add("hidden");
}

// ---- live evaluation (debounced; ignores out-of-date responses)
let timer = null;
let seq = 0;

async function evaluate() {
  const data = collect();
  const anything = Object.values(data).some((v) => v !== null && v !== undefined) || manual.length > 0;
  if (!anything) { showEmpty(); return; }

  const mine = ++seq;
  try {
    const r = await authFetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // only template ids and keys are sent - never a text typed or edited on this PC
      body: JSON.stringify({ data, manual, dismissed: [...dismissed] }),
    });
    if (!r.ok) throw new Error(`Server error (${r.status})`);
    const out = await r.json();
    if (mine === seq) render(out);
  } catch (e) {
    if (mine !== seq) return;
    $("err").textContent = "❌ " + e.message + " — server চালু আছে কিনা দেখুন।";
    $("err").classList.remove("hidden");
  }
}

function onChange() {
  updateVisibility();
  clearTimeout(timer);
  timer = setTimeout(evaluate, 250);
}

const skipEval = (e) => e.target.closest(".picker, .noeval");
form.addEventListener("input", (e) => { if (!skipEval(e)) onChange(); });
form.addEventListener("change", (e) => { if (!skipEval(e)) onChange(); });
form.addEventListener("submit", (e) => e.preventDefault());
$("copyOrder").addEventListener("change", updateCopyNote);

// ---- Reset case: really clears everything about the current case
function resetCase() {
  saveHistory();
  form.reset();
  fillForm({});
  manual = []; dismissed.clear(); FILLS = {}; CURRENT = null;
  $("caseNotes").value = "";
  $("pkQ").value = ""; $("pkSec").value = "all"; $("pkMode").value = "qi";
  $("nidHint").textContent = ""; $("imeiHint").textContent = "";
  if (window.TPStmtUI) TPStmtUI.reset();
  renderPicker();
  updateVisibility();
  showEmpty();
  showTab("check");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("reset").addEventListener("click", resetCase);

$("copy").addEventListener("click", () => {
  const lines = bpLines();
  if (!lines.length) return;
  copyText(lines.map((l, i) => `${i + 1}. ${l.text}`).join("\n"), $("copy"), "✅ Copy হয়েছে");
  saveHistory();
});

// ============================================================ local history (last 20 cases, this PC only)
const HIST_KEY = "tp_history_v1";
function saveHistory() {
  if (!CURRENT) return;
  const data = collect();
  const entry = {
    t: Date.now(), status: CURRENT.status, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)),
    manual: manual.map((m) => ({ tid: m.tid, kind: m.kind })), dismissed: [...dismissed],
    reasons: CURRENT.reasons.map((r) => ({ id: r.id, kind: r.kind, tid: r.tid, src: r.source, off: r.dismissed })),
  };
  const sig = JSON.stringify([entry.data, entry.manual, entry.dismissed]);
  const list = lsGet(HIST_KEY, []).filter((h) => h.sig !== sig);
  entry.sig = sig;
  list.unshift(entry);
  lsSet(HIST_KEY, list.slice(0, 20));
  renderHistory();
}
function shortOf(r) {
  const it = r.tid && LIB_BY_ID[r.tid];
  const t = it ? shownText(it.it) : r.id;
  return t.length > 48 ? t.slice(0, 46) + "…" : t;
}
function renderHistory() {
  const box = $("histList");
  if (!box) return;
  const list = lsGet(HIST_KEY, []);
  box.innerHTML = "";
  $("histClear").classList.toggle("hidden", list.length === 0);
  if (!list.length) { box.innerHTML = '<p class="muted">এখনো কিছু নেই।</p>'; return; }
  list.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "histrow";
    const info = document.createElement("div");
    info.className = "hinfo";
    const cls = STATUS_CLASS[h.status] || "need";
    const dot = document.createElement("span");
    dot.className = "dot " + cls;
    info.appendChild(dot);
    info.appendChild(document.createTextNode(h.status));
    const sm = document.createElement("small");
    const when = new Date(h.t).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
    const shown = h.reasons.filter((r) => !r.off).slice(0, 2).map(shortOf).join(" · ");
    sm.textContent = `${when} · ${h.reasons.length}টি reason${shown ? " · " + shown : ""}`;
    info.appendChild(sm);
    row.appendChild(info);
    row.appendChild(mkBtn("↻ আবার load", "mini", () => loadHistory(i)));
    row.appendChild(mkBtn("✖", "mini danger", () => { const l = lsGet(HIST_KEY, []); l.splice(i, 1); lsSet(HIST_KEY, l); renderHistory(); }));
    box.appendChild(row);
  });
}
function loadHistory(i) {
  const h = lsGet(HIST_KEY, [])[i];
  if (!h) return;
  fillForm(h.data || {});
  manual = (h.manual || []).slice(); dismissed.clear(); (h.dismissed || []).forEach((k) => dismissed.add(k)); FILLS = {};
  renderPicker(); updateVisibility(); evaluate();
  showTab("check");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("histClear").addEventListener("click", () => { if (confirm("History মুছে যাবে।")) { lsSet(HIST_KEY, []); renderHistory(); } });

// ============================================================ template library (Templates tab)
function templateTags(card, it) {
  const wrap = document.createElement("div");
  wrap.className = "tags";
  if (it.overridden) addTag(wrap, "global", `Admin edit${it.edited_at ? " · " + fmtDate(it.edited_at) : ""}`);
  if (it.custom) addTag(wrap, "custom", "Admin-এর নতুন");
  if (it.new) addTag(wrap, "new", "নতুন (return data থেকে) · review");
  if (it.changed) addTag(wrap, "chg", "SOP বদলের পর নতুন লেখা");
  if (it.hidden) addTag(wrap, "hid", "লুকানো (users দেখে না)");
  if (it.engine && ROLE === "admin") addTag(wrap, "eng", "rule engine ব্যবহার করে");
  if (LOCAL[it.id]) {
    addTag(wrap, "pc", "আপনার PC-র edit");
    if (LOCAL[it.id].base !== it.text) addTag(wrap, "warn", "⚠ Admin পরে global text বদলেছে");
  }
  if (wrap.children.length) card.appendChild(wrap);
}

async function ensureLib(force = false) {
  if (LIB && !force) return true;
  try { LIB = await api("/api/templates"); } catch { return false; }
  LIB_BY_ID = {};
  LIB.sections.forEach((s) => s.items.forEach((it) => { LIB_BY_ID[it.id] = { it, s }; }));
  buildChips();
  buildPicker();
  renderHistory();
  return true;
}

function renderLib() {
  if (!LIB) return;
  const q = $("q").value.trim().toLowerCase();
  const list = $("libList");
  list.innerHTML = "";
  LIB.sections.forEach((s) => {
    if (activeSection !== "all" && activeSection !== s.id) return;
    const items = s.items.map((it) => ({ it, t: shownText(it) })).filter((x) => !q || x.t.toLowerCase().includes(q) || x.it.id.includes(q));
    if (!items.length) return;
    const h = document.createElement("h3");
    h.className = "libhead " + s.kind;
    h.textContent = `${s.title} (${items.length})`;
    list.appendChild(h);
    items.forEach(({ it, t }) => {
      const card = document.createElement("div");
      card.className = "tpl " + s.kind;
      const p = document.createElement("div");
      p.className = "tpltext";
      p.textContent = t;
      card.appendChild(p);
      templateTags(card, it);
      const hint = document.createElement("span");
      hint.className = "copyhint";
      hint.textContent = "ক্লিক করে copy";
      card.appendChild(hint);
      card.appendChild(mkBtn("✏️ Edit", "mini editbtn", (e) => { e.stopPropagation(); openEditor(it.id); }));
      card.addEventListener("click", () => copyText(t, hint, "✅ Copy হয়েছে"));
      list.appendChild(card);
    });
  });
  if (!list.children.length) list.innerHTML = '<p class="muted">কিছু পাওয়া যায়নি।</p>';
}

function buildChips() {
  const chips = $("chips");
  chips.innerHTML = "";
  [{ id: "all", title: "সব" }, ...LIB.sections].forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (s.id === activeSection ? " on" : "");
    b.textContent = s.title;
    b.addEventListener("click", () => { activeSection = s.id; buildChips(); renderLib(); });
    chips.appendChild(b);
  });
}

async function openLib() {
  if (!(await ensureLib(true))) { $("libList").textContent = "টেমপ্লেট লোড করা যায়নি।"; return; }
  renderLib();
}
$("q").addEventListener("input", renderLib);

// ---- template editor (dialog): edit box + live preview + placeholder warning
let editing = null;   // {it, s} or null for "new template"

function checkWarn() {
  const sec = editing ? editing.s : (LIB && LIB.sections.find((s) => s.id === $("dlgSec").value));
  const text = $("dlgText").value;
  const msgs = [];
  if (sec && sec.kind === "reject" && hasBangla(text)) msgs.push("⚠️ Reject reason সবসময় English-এ রাখুন (বাংলা অক্ষর server নেবে না)।");
  if (/[<>]/.test(text)) msgs.push("⚠️ < এবং > চিহ্ন ব্যবহার করা যাবে না।");
  if (editing) {
    const had = placeholdersOf(editing.it.builtin_text || editing.it.text);
    const now = placeholdersOf(text);
    const lost = had.filter((k) => !now.includes(k));
    if (lost.length) msgs.push(`⚠️ ${lost.map((k) => "{" + k + "}").join(", ")} মুছে গেছে — তাই এই অংশটা আর নিজে থেকে (মাসের নাম ইত্যাদি) আপডেট হবে না।`);
  }
  $("dlgWarn").textContent = msgs.join("\n");
  $("dlgWarn").classList.toggle("hidden", msgs.length === 0);
  const ph = placeholdersOf(text);
  $("dlgPh").textContent = ph.length ? "Placeholder: " + ph.map((k) => "{" + k + "}" + (k in ctx() ? " (নিজে থেকে বসে)" : " (reviewer লেখে)")).join(", ") : "";
  $("dlgPreview").textContent = renderTpl(text) || "—";
}

function openEditor(id) {
  if (!LIB) return;
  editing = id ? LIB_BY_ID[id] : null;
  const isNew = !editing;
  const it = editing && editing.it;
  $("dlgTitle").textContent = isNew ? "নতুন template (সবার জন্য)" : "Template edit";
  $("dlgMsg").textContent = "";
  const sec = $("dlgSec");
  sec.classList.toggle("hidden", !isNew);
  if (isNew) {
    sec.innerHTML = "";
    LIB.sections.forEach((s) => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.title; sec.appendChild(o); });
  }
  $("dlgText").value = isNew ? "" : rawText(it);
  let info = isNew ? "Admin হিসেবে যোগ করলে সবাই দেখতে পাবে।" : `${editing.s.title} · ID ${it.id}`;
  if (it && it.overridden) info += ` · Admin শেষ edit: ${it.edited_by || "admin"}, ${fmtDate(it.edited_at)}`;
  if (it && it.custom) info += ` · Admin-এর যোগ করা (${it.edited_by || "admin"}, ${fmtDate(it.edited_at)})`;
  if (it && LOCAL[it.id]) info += " · এই PC-তে আপনার নিজের edit আছে।";
  if (editing && editing.s.kind === "reject") info += " · Reject reason সবসময় English।";
  $("dlgInfo").textContent = info;
  const gt = $("dlgGlobalText");
  if (it && LOCAL[it.id]) {
    const changed = LOCAL[it.id].base !== it.text;
    gt.textContent = (changed ? "⚠️ আপনার edit করার পর Admin মূল (global) text বদলেছে। এখনকার global text: " : "Global text (আপনার edit মুছলে এটা ফিরবে): ") + renderTpl(it.text);
  } else gt.textContent = "";
  $("dlgLocal").classList.toggle("hidden", isNew);
  $("dlgResetLocal").classList.toggle("hidden", isNew || !LOCAL[it.id]);
  $("dlgCopy").classList.toggle("hidden", isNew);
  $("dlgGlobal").classList.toggle("hidden", ROLE !== "admin");
  $("dlgGlobal").textContent = isNew ? "➕ সবার জন্য তৈরি করুন" : "🌐 সবার জন্য save (admin)";
  $("dlgResetGlobal").classList.toggle("hidden", !(ROLE === "admin" && it && !it.custom && it.overridden));
  $("dlgDelete").classList.toggle("hidden", !(ROLE === "admin" && it && it.custom));
  const hideBtn = $("dlgHide");
  hideBtn.classList.toggle("hidden", !(ROLE === "admin" && it && !it.engine));
  if (it) hideBtn.textContent = it.hidden ? "👁 আবার users-দের দেখান (admin)" : "🙈 Users-দের কাছ থেকে লুকান (admin)";
  checkWarn();
  $("tplDlg").showModal();
}

function refreshAfterTemplateChange() {
  renderLib(); renderPicker(); evaluate(); renderHistory();
}

$("dlgText").addEventListener("input", checkWarn);
$("dlgSec").addEventListener("change", checkWarn);
$("dlgClose").addEventListener("click", () => $("tplDlg").close());
$("tplNew").addEventListener("click", () => openEditor(null));
$("dlgCopy").addEventListener("click", () => copyText(renderTpl($("dlgText").value), $("dlgCopy")));

$("dlgLocal").addEventListener("click", () => {
  const text = $("dlgText").value.trim();
  if (text.length < 3) { $("dlgMsg").textContent = "⚠️ লেখা খুব ছোট।"; return; }
  const it = editing.it;
  if (text === it.text) delete LOCAL[it.id]; else LOCAL[it.id] = { text, base: it.text, at: Date.now() };
  if (lsSet(LOCAL_KEY, LOCAL)) { $("tplDlg").close(); refreshAfterTemplateChange(); }
  else $("dlgMsg").textContent = "❌ এই browser-এ edit save করা যাচ্ছে না (private mode?)।";
});
$("dlgResetLocal").addEventListener("click", () => {
  delete LOCAL[editing.it.id];
  lsSet(LOCAL_KEY, LOCAL); $("tplDlg").close(); refreshAfterTemplateChange();
});

async function adminTplCall(fn) {
  try {
    await fn();
    if (editing) { delete LOCAL[editing.it.id]; lsSet(LOCAL_KEY, LOCAL); }   // the admin should see what everybody sees
    await ensureLib(true);
    $("tplDlg").close();
    refreshAfterTemplateChange(); renderLib();
  } catch (e) { $("dlgMsg").textContent = "❌ " + e.message; }
}
$("dlgGlobal").addEventListener("click", () => {
  const text = $("dlgText").value.trim();
  if (text.length < 3) { $("dlgMsg").textContent = "⚠️ লেখা খুব ছোট।"; return; }
  adminTplCall(() => (editing
    ? api(`/api/templates/${encodeURIComponent(editing.it.id)}`, "PUT", { text })
    : api("/api/templates", "POST", { text, section: $("dlgSec").value })));
});
$("dlgResetGlobal").addEventListener("click", () => {
  if (!confirm("Admin-এর edit মুছে built-in লেখায় ফিরবে। সবার জন্য।")) return;
  adminTplCall(() => api(`/api/templates/${encodeURIComponent(editing.it.id)}/reset`, "POST"));
});
$("dlgDelete").addEventListener("click", () => {
  if (!confirm("এই template সবার জন্য মুছে যাবে।")) return;
  adminTplCall(() => api(`/api/templates/${encodeURIComponent(editing.it.id)}`, "DELETE"));
});
$("dlgHide").addEventListener("click", () => {
  adminTplCall(() => api(`/api/templates/${encodeURIComponent(editing.it.id)}/hidden`, "POST", { hidden: !editing.it.hidden }));
});

// ---- export / import of this PC's own edits (a small JSON file)
$("tplExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, edits: LOCAL }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "toppay-my-template-edits.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("tplImport").addEventListener("click", () => $("tplFile").click());
$("tplFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const edits = data && data.edits;
    if (!edits || typeof edits !== "object") throw new Error("ফাইল ঠিক নেই");
    let n = 0;
    Object.entries(edits).forEach(([id, v]) => {
      if (typeof id === "string" && v && typeof v.text === "string" && v.text.length >= 3 && v.text.length <= 2000 && !/[<>]/.test(v.text)) {
        LOCAL[id] = { text: v.text, base: typeof v.base === "string" ? v.base : "", at: Date.now() };
        n++;
      }
    });
    if (lsSet(LOCAL_KEY, LOCAL)) { alert(`${n}টি edit import হয়েছে।`); refreshAfterTemplateChange(); }
  } catch (err) { alert("❌ Import হয়নি: " + err.message); }
});

// ============================================================ manual reason picker (searchable, grouped, multi-select)
function buildPicker() {
  const sel = $("pkSec");
  const keep = sel.value || "all";
  sel.innerHTML = "";
  [{ id: "all", title: "সব section" }, ...LIB.sections].forEach((s) => {
    const o = document.createElement("option"); o.value = s.id; o.textContent = s.title; sel.appendChild(o);
  });
  sel.value = keep;
  renderPicker();
}

function addManual(kind, it) {
  if (manual.some((m) => m.tid === it.id)) return;
  manual.push({ tid: it.id, kind });
  renderPicker(); evaluate();
}

function renderIndicators(list, q) {
  let n = 0;
  [["return", "↩ RETURN reasons (Quality Indicators)"], ["reject", "⛔ REJECT reasons (Quality Indicators)"]].forEach(([kind, title]) => {
    const groups = (LIB.indicators && LIB.indicators[kind]) || [];
    const wrap = document.createElement("div");
    groups.forEach((g) => {
      const rows = g.items.filter((x) => {
        const it = LIB_BY_ID[x.tid];
        return !q || x.label.toLowerCase().includes(q) || (it && shownText(it.it).toLowerCase().includes(q));
      });
      if (!rows.length) return;
      const h = document.createElement("div");
      h.className = "pkhead " + kind;
      h.textContent = `${kind === "return" ? "Return" : "Reject"} · ${g.category}`;
      wrap.appendChild(h);
      rows.forEach((x) => {
        n++;
        const it = LIB_BY_ID[x.tid];
        const row = document.createElement("div");
        row.className = "pkrow";
        const p = document.createElement("div");
        p.className = "pktext";
        const b = document.createElement("b");
        b.textContent = `${x.n}. ${x.label}`;
        p.appendChild(b);
        if (it) {
          const small = document.createElement("small");
          small.style.display = "block";
          small.textContent = shownText(it.it);
          p.appendChild(small);
        }
        row.appendChild(p);
        const btns = document.createElement("div");
        btns.className = "rbtns";
        const added = manual.find((m) => m.tid === x.tid);
        if (!it) {
          btns.textContent = "template পাওয়া যায়নি";
        } else if (added) {
          btns.appendChild(mkBtn("✔ যোগ করা আছে · সরান", "mini danger", () => { manual = manual.filter((m) => m.tid !== x.tid); renderPicker(); evaluate(); }));
        } else {
          btns.appendChild(mkBtn(kind === "return" ? "↩ Return যোগ" : "⛔ Reject যোগ", kind === "return" ? "mini" : "mini danger", () => addManual(kind, it.it)));
        }
        row.appendChild(btns);
        wrap.appendChild(row);
      });
    });
    if (wrap.children.length) {
      const t = document.createElement("h3");
      t.className = "libhead " + kind;
      t.textContent = title;
      list.appendChild(t);
      list.appendChild(wrap);
    }
  });
  if (!n) list.innerHTML = '<p class="muted">কিছু পাওয়া যায়নি।</p>';
}

function renderPicker() {
  const list = $("pkList");
  if (!LIB) { list.textContent = ""; return; }
  const q = $("pkQ").value.trim().toLowerCase();
  const qi = $("pkMode").value === "qi" && LIB.indicators;
  $("pkSec").classList.toggle("hidden", !!qi);
  if (qi) { list.innerHTML = ""; renderIndicators(list, q); return; }
  const sec = $("pkSec").value || "all";
  list.innerHTML = "";
  let n = 0, more = false;
  outer: for (const s of LIB.sections) {
    if (sec !== "all" && sec !== s.id) continue;
    let headDone = false;
    for (const it of s.items) {
      const t = shownText(it);
      if (q && !t.toLowerCase().includes(q)) continue;
      if (++n > 40) { more = true; break outer; }
      if (!headDone && sec === "all") {
        const h = document.createElement("div");
        h.className = "pkhead " + s.kind;
        h.textContent = s.title;
        list.appendChild(h);
        headDone = true;
      }
      const row = document.createElement("div");
      row.className = "pkrow";
      const p = document.createElement("div");
      p.className = "pktext";
      p.textContent = t;
      row.appendChild(p);
      const added = manual.find((m) => m.tid === it.id);
      const btns = document.createElement("div");
      btns.className = "rbtns";
      if (added) {
        btns.appendChild(mkBtn(`✔ ${added.kind === "reject" ? "Reject" : "Return"}-এ আছে · সরান`, "mini danger", () => {
          manual = manual.filter((m) => m.tid !== it.id); renderPicker(); evaluate();
        }));
      } else {
        btns.appendChild(mkBtn("↩ Return", "mini", () => addManual("return", it)));
        const rj = mkBtn("⛔ Reject", "mini danger", () => addManual("reject", it));
        if (hasBangla(t)) { rj.disabled = true; rj.title = "Reject reason English হতে হবে"; }
        btns.appendChild(rj);
      }
      row.appendChild(btns);
      list.appendChild(row);
    }
  }
  if (!n) list.innerHTML = '<p class="muted">কিছু পাওয়া যায়নি।</p>';
  if (more) { const m = document.createElement("p"); m.className = "muted"; m.textContent = "আরো আছে — খোঁজার শব্দ আরো নির্দিষ্ট করুন।"; list.appendChild(m); }
}
$("pkQ").addEventListener("input", renderPicker);
$("pkSec").addEventListener("change", renderPicker);
$("pkMode").addEventListener("change", renderPicker);

// ============================================================ tabs
function showTab(which) {
  document.querySelector(".layout").classList.toggle("hidden", which !== "check");
  $("viewLib").classList.toggle("hidden", which !== "lib");
  $("viewStmt").classList.toggle("hidden", which !== "stmt");
  $("viewAdmin").classList.toggle("hidden", which !== "admin");
  ["Check:check", "Lib:lib", "Stmt:stmt", "Admin:admin"].forEach((x) => {
    const [id, key] = x.split(":");
    $("tab" + id).classList.toggle("active", which === key);
  });
  if (which === "lib") openLib();
  if (which === "admin") loadAdmin();
}
$("tabCheck").addEventListener("click", () => showTab("check"));
$("tabLib").addEventListener("click", () => showTab("lib"));
$("tabStmt").addEventListener("click", () => showTab("stmt"));
$("tabAdmin").addEventListener("click", () => showTab("admin"));

updateVisibility();

// ---------- format checks for NID / IMEI (client side only) ----------
function luhnOk(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function hint(el, ok, text) {
  el.textContent = text;
  el.style.color = ok === null ? "" : ok ? "var(--green)" : "var(--red)";
}
$("nidNo").addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "");
  e.target.value = v;
  if (!v) return hint($("nidHint"), null, "");
  [10, 13, 17].includes(v.length)
    ? hint($("nidHint"), true, `✔ ${v.length} digit — format ঠিক আছে (portal-এ যাচাই করুন)`)
    : hint($("nidHint"), false, `${v.length} digit — NID 10, 13 বা 17 digit হয়`);
});
$("imeiNo").addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "");
  e.target.value = v;
  if (!v) return hint($("imeiHint"), null, "");
  if (v.length < 15) return hint($("imeiHint"), false, `${v.length}/15 digit`);
  luhnOk(v)
    ? hint($("imeiHint"), true, "✔ 15 digit, checksum ঠিক আছে")
    : hint($("imeiHint"), false, "✖ checksum মেলেনি — IMEI ভুল হতে পারে");
});

// ---------- mobile: result is a bottom sheet, tap the badge to expand ----------
$("badge").addEventListener("click", () => $("resultcol").classList.toggle("open"));

// ---------- login form, logout, session check ----------
function applyRole(role) {
  ROLE = role;
  $("tabAdmin").classList.toggle("hidden", role !== "admin");
  $("tplNew").classList.toggle("hidden", role !== "admin");
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("lbtn");
  btn.disabled = true; btn.textContent = "অপেক্ষা করুন…";
  try {
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("lu").value, password: $("lp").value }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.detail || "Login হয়নি");
    setToken(out.token);
    $("lp").value = "";
    applyRole(out.role);
    showApp();
  } catch (err) {
    showLogin("❌ " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Login";
  }
});

$("logout").addEventListener("click", () => {
  setToken(null); LIB = null; LIB_BY_ID = {}; manual = []; dismissed.clear(); FILLS = {}; ME = null; applyRole("user");
  form.reset(); fillForm({}); $("caseNotes").value = ""; if (window.TPStmtUI) TPStmtUI.reset();
  updateVisibility(); showEmpty(); showTab("check");
  showLogin("");
});

(async function boot() {
  if (!getToken()) { showLogin(""); return; }
  try {
    const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + getToken() } });
    if (r.ok) { ME = await r.json(); applyRole(ME.role); showApp(); } else { setToken(null); showLogin(""); }
  } catch { showLogin("Server-এর সাথে যোগাযোগ করা যাচ্ছে না।"); }
})();

// ---------- suggestion box (goes to the owner's mail on the server; address never shown here) ----------
$("fbSend").addEventListener("click", async () => {
  const st = $("fbStatus"), btn = $("fbSend");
  const email = $("fbEmail").value.trim(), message = $("fbMsg").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = "⚠️ সঠিক email দিন।"; return; }
  if (message.length < 5) { st.textContent = "⚠️ মেসেজটা একটু বড় করে লিখুন।"; return; }
  btn.disabled = true; st.textContent = "পাঠানো হচ্ছে…";
  try {
    const r = await authFetch("/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, message, website: $("fbWebsite").value }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.detail || "পাঠানো যায়নি");
    st.textContent = "✅ ধন্যবাদ! আপনার মেসেজ পাঠানো হয়েছে।";
    $("fbMsg").value = "";
  } catch (err) {
    st.textContent = "❌ " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- admin: the one shared login + set-up warnings ----------
async function loadAdmin() {
  const note = $("sharedNote");
  try {
    const me = await api("/api/me");
    const w = $("admWarn");
    w.classList.toggle("hidden", !(me.warnings && me.warnings.length));
    w.innerHTML = "";
    if (me.warnings && me.warnings.length) {
      const h = document.createElement("h3"); h.textContent = "⚠️ Set-up সতর্কতা"; w.appendChild(h);
      const ul = document.createElement("ul");
      me.warnings.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      w.appendChild(ul);
    }
    try { renderPolicy(await api("/api/policy")); } catch (e) { $("polNote").textContent = "❌ " + e.message; }
    const out = await api("/api/admin/shared-login");
    let t = out.display
      ? `এখন চালু আছে: ID "${out.display}" (${out.source === "env" ? "Vercel env থেকে" : "admin panel থেকে"})।`
      : "এখনো কোনো shared login নেই। নিচে ID ও Password দিয়ে বানান।";
    if (out.storage === null) t += " ⚠️ Database যুক্ত নেই, তাই এখান থেকে বদলানো যাবে না — Vercel env USER_ID / USER_PASS ব্যবহার করুন।";
    note.textContent = t + " বদলালে পুরোনো login ২০ সেকেন্ড থেকে ১ মিনিটের মধ্যে বন্ধ হবে।";
    if (out.display && !$("shU").value) $("shU").value = out.display;
  } catch (e) { note.textContent = "❌ " + e.message; }
}

// ----- policy editor: the form is built from the field list the server sends
let POL_SPEC = null;
function polInput(spec, v) {
  const wrap = document.createElement("label");
  wrap.className = "pol";
  const t = document.createElement("span");
  t.textContent = spec.label + (spec.unit ? ` (${spec.unit})` : "");
  wrap.appendChild(t);
  let inp;
  if (spec.type === "bool") {
    inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = !!v;
  } else if (spec.type === "multi") {
    inp = document.createElement("div"); inp.className = "polmulti";
    Object.entries(spec.choices).forEach(([k, name]) => {
      const l = document.createElement("label"); l.className = "check";
      const c = document.createElement("input"); c.type = "checkbox"; c.value = k; c.checked = v.map(String).includes(String(k));
      l.appendChild(c); l.appendChild(document.createTextNode(" " + name)); inp.appendChild(l);
    });
  } else {
    inp = document.createElement("input"); inp.type = "number"; inp.value = v;
    inp.min = spec.min; inp.max = spec.max; inp.step = spec.type === "float" ? "0.05" : "1";
  }
  inp.dataset.key = spec.key;
  wrap.appendChild(inp);
  if (spec.help) { const s = document.createElement("small"); s.textContent = spec.help; wrap.appendChild(s); }
  return wrap;
}
function polRead() {
  const out = {};
  POL_SPEC.forEach((s) => {
    const el = $("polForm").querySelector(`[data-key="${s.key}"]`);
    if (!el) return;
    if (s.type === "bool") out[s.key] = el.checked;
    else if (s.type === "multi") {
      const vals = [...el.querySelectorAll("input:checked")].map((c) => c.value);
      out[s.key] = s.key === "weekend_days" ? vals.map(Number) : vals;
    } else out[s.key] = el.value === "" ? null : Number(el.value);
  });
  return out;
}
function renderPolicy(info) {
  POLICY = info;
  POL_SPEC = info.spec;
  const box = $("polForm");
  box.innerHTML = "";
  let grp = null, grid = null;
  info.spec.forEach((s) => {
    if (s.group !== grp) {
      grp = s.group;
      const h = document.createElement("h4"); h.textContent = grp; box.appendChild(h);
      grid = document.createElement("div"); grid.className = "grid"; box.appendChild(grid);
    }
    const w = polInput(s, info.values[s.key]);
    if (info.changed.includes(s.key)) w.classList.add("changed");
    grid.appendChild(w);
  });
  const n = info.changed.length;
  $("polNote").textContent = (n ? `${n}টি সেটিং default থেকে আলাদা (হলুদ চিহ্ন)। ` : "সব সেটিং default-এ আছে। ") +
    (info.by ? `শেষ বদল: ${info.by}, ${fmtDate(info.at)}। ` : "") +
    (info.storage === null ? "⚠️ Database যুক্ত নেই, তাই বদলানো যাবে না।" : "Save করলে সবার জন্য সাথে সাথে কাজ করবে।");
  const NAMES = Object.fromEntries(info.spec.map((s) => [s.key, s.label]));
  $("polLog").innerHTML = "";
  (info.log || []).slice(0, 15).forEach((e) => {
    const d = document.createElement("div");
    d.textContent = `${fmtDate(e.at)} · ${e.by}${e.reset ? " (reset)" : ""}: ` +
      Object.entries(e.changes).map(([k, [a, b]]) => `${NAMES[k] || k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join("; ");
    $("polLog").appendChild(d);
  });
  if (!(info.log || []).length) $("polLog").textContent = "এখনো কোনো বদল নেই।";
}
$("polSave").addEventListener("click", async () => {
  const st = $("polStatus");
  try {
    const out = await api("/api/admin/policy", "PUT", { values: polRead() });
    renderPolicy(out);
    st.textContent = Object.keys(out.changed).length ? "✅ Save হয়েছে — এখন থেকে নতুন নিয়ম চলবে।" : "কিছু বদলায়নি।";
    if (LIB) { await ensureLib(true); }
    evaluate();
  } catch (e) { st.textContent = "❌ " + e.message; }
});
$("polReset").addEventListener("click", async () => {
  if (!confirm("সব সংখ্যা SOP-র default মানে ফিরে যাবে। নিশ্চিত?")) return;
  try { renderPolicy(await api("/api/admin/policy/reset", "POST", { keys: null })); $("polStatus").textContent = "✅ Default-এ ফিরেছে।"; evaluate(); }
  catch (e) { $("polStatus").textContent = "❌ " + e.message; }
});

$("shSave").addEventListener("click", async () => {
  const st = $("shStatus");
  try {
    await api("/api/admin/shared-login", "PUT", { username: $("shU").value, password: $("shP").value });
    st.textContent = "✅ Save হয়েছে। এখনই সবাইকে নতুন ID/Password জানান — password পরে আর দেখা যাবে না।";
    $("shP").value = "";
    loadAdmin();
  } catch (e) { st.textContent = "❌ " + e.message; }
});

$("shGen").addEventListener("click", (e) => {
  e.preventDefault();
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  $("shP").value = Array.from(a, (n) => chars[n % chars.length]).join("");
});

// ---------- MRP = Total Product Amount - 10% (SOP); still editable afterwards ----------
$("totalAmt").addEventListener("input", () => {
  const v = Number($("totalAmt").value);
  if (!v) return;
  form.elements.mrp.value = Math.round(v * pv("mrp_factor", 0.9));
  form.elements.mrp.dispatchEvent(new Event("input", { bubbles: true }));
});

// ---------- hooks for the statement checker tab ----------
window.TPApp = {
  // the Statement tab hands over ONLY derived numbers / flags; the PDF and its text never reach this file
  setFields(values) {
    Object.entries(values).forEach(([name, v]) => {
      const el = form.elements[name];
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!v; else el.value = v === null || v === undefined ? "" : String(v);
    });
    onChange();
  },
  showCheck() { showTab("check"); },
  addManual(tid, kind) { if (!manual.some((m) => m.tid === tid)) { manual.push({ tid, kind }); renderPicker(); evaluate(); } },
  hasManual(tid) { return manual.some((m) => m.tid === tid); },
  lib() { return LIB; },
  shownText(tid) { const x = LIB_BY_ID[tid]; return x ? shownText(x.it) : ""; },
  today: dhakaToday,
  policy: () => (POLICY && POLICY.values) || {},
};
if (window.TPStmtUI) TPStmtUI.init(window.TPApp);
