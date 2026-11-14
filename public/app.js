"use strict";

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
  "APPROVED": "approved",
  "ACTION REQUIRED": "action",
  "RETURNED": "returned",
  "REJECTED / SUSPECTED FRAUD": "rejected",
  "MORE INFO NEEDED": "need",
};
const STATUS_ICON = { approved: "✅", action: "⚠️", returned: "↩️", rejected: "⛔", need: "❓" };

let lastText = "";

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
}
// fetch with the login token; a 401 sends the user back to the login screen
async function authFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + (getToken() || "") });
  const r = await fetch(url, Object.assign({}, opts, { headers }));
  if (r.status === 401) { setToken(null); showLogin("Session শেষ। আবার Login করুন।"); throw new Error("Login দরকার"); }
  return r;
}   // plain-text summary for the "copy all" button

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

// ------------------------------------------------------------ render result
// items: [{text, msg}]  - msg is the ready-to-send official message
function fillItems(id, items, boxId, copyReason) {
  const ul = $(id);
  ul.innerHTML = "";
  items.forEach((it) => {
    const li = document.createElement("li");
    const t = document.createElement("div");
    t.textContent = it.text;                 // textContent: safe against HTML injection
    li.appendChild(t);

    const toCopy = it.msg || (copyReason ? it.text : null);
    if (it.msg) {
      const lab = document.createElement("div");
      lab.className = "bplabel";
      lab.textContent = "BP-কে পাঠানোর মেসেজ";
      li.appendChild(lab);
      const box = document.createElement("div");
      box.className = "msgbox";
      box.textContent = it.msg;
      li.appendChild(box);
    }
    if (toCopy) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mini";
      b.textContent = it.msg ? "📋 BP-র মেসেজ copy" : "📋 Reject reason copy";
      b.addEventListener("click", () => copyText(toCopy, b));
      li.appendChild(b);
    }
    ul.appendChild(li);
  });
  if (boxId) $(boxId).classList.toggle("hidden", items.length === 0);
}

function fillStrings(id, items) {
  const ul = $(id);
  ul.innerHTML = "";
  items.forEach((s) => { const li = document.createElement("li"); li.textContent = s; ul.appendChild(li); });
}

function render(res) {
  $("empty").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("err").classList.add("hidden");

  const cls = STATUS_CLASS[res.status] || "need";
  $("badge").className = "badge " + cls;
  $("badge").textContent = `${STATUS_ICON[cls]} ${res.status}`;

  $("fast").classList.toggle("hidden", !res.fast_track);
  $("fast").textContent = res.fast_track ? "🔒 Internal · " + res.fast_track_msg : "";

  const missing = res.missing.map((m) => ({ text: m[1], msg: null }));
  fillItems("missing", missing, "missingBox", false);
  fillItems("rejects", res.rejects, "rejectsBox", true);
  fillItems("returns", res.returns, "returnsBox", false);
  fillItems("actions", res.actions, "actionsBox", false);
  fillStrings("passed", res.passed);
  fillStrings("notes", res.notes);
  $("internalBox").classList.toggle("hidden", res.notes.length === 0 && !res.fast_track);

  // only official, BP-facing text goes into the copy: reject reasons (English) and return/action messages
  const lines = [`TopPay সিদ্ধান্ত: ${res.status}`];
  const rej = res.rejects.map((a) => a.msg || a.text);
  const bp = [...res.returns, ...res.actions].filter((a) => a.msg).map((a) => a.msg);
  if (rej.length) lines.push("", ...rej.map((t) => "- " + t));
  if (bp.length) lines.push("", ...bp.map((t) => "- " + t));
  lastText = lines.join("\n");
}

function showEmpty() {
  $("empty").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("err").classList.add("hidden");
}

// ---- live evaluation (debounced; ignores out-of-date responses)
let timer = null;
let seq = 0;

async function evaluate() {
  const data = collect();
  const anything = Object.values(data).some((v) => v !== null && v !== undefined);
  if (!anything) { showEmpty(); return; }

  const mine = ++seq;
  try {
    const r = await authFetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!r.ok) throw new Error(`Server error (${r.status})`);
    const out = await r.json();
    if (mine === seq) render(out.result);
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

form.addEventListener("input", onChange);
form.addEventListener("change", onChange);
form.addEventListener("submit", (e) => e.preventDefault());

$("reset").addEventListener("click", () => {
  form.reset();
  updateVisibility();
  showEmpty();
  showTab("check");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("copy").addEventListener("click", () => copyText(lastText, $("copy"), "✅ Copy হয়েছে"));

// ============================================================ template library
const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই",
                   "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"];

// last three full months in Bangladesh time
function lastThree() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", month: "numeric", year: "numeric" })
    .formatToParts(new Date());
  const m = Number(parts.find((p) => p.type === "month").value) - 1;
  return [3, 2, 1].map((k) => ((m - k) % 12 + 12) % 12);
}

function freshMonths(text) {
  const [a, b, c] = lastThree();
  const en = `${EN_MONTHS[a]}, ${EN_MONTHS[b]}, ${EN_MONTHS[c]}`;
  const bn = `${BN_MONTHS[a]}, ${BN_MONTHS[b]}, ${BN_MONTHS[c]}`;
  return text
    .replace(/August, September, October/g, en)
    .replace(/May, June,\s?July/g, en)
    .replace(/জুলাই,\s?আগষ্ট,\s?সেপ্টেম্বর/g, bn)
    .replace(/জুলাই অগাস্ট সেপ্টেম্বর/g, bn.replace(/, /g, " "))
    .replace(/আগস্ট এর ১ তারিখ/g, `${BN_MONTHS[a]} এর ১ তারিখ`)
    .replace(/১লা আগস্ট/g, `১লা ${BN_MONTHS[a]}`);
}

let LIB = null;
let activeSection = "all";

function renderLib() {
  const q = $("q").value.trim().toLowerCase();
  const list = $("libList");
  list.innerHTML = "";
  LIB.sections.forEach((s) => {
    if (activeSection !== "all" && activeSection !== s.id) return;
    const items = s.items.map(freshMonths).filter((t) => !q || t.toLowerCase().includes(q));
    if (!items.length) return;

    const h = document.createElement("h3");
    h.className = "libhead " + s.kind;
    h.textContent = `${s.title} (${items.length})`;
    list.appendChild(h);

    items.forEach((t) => {
      const card = document.createElement("div");
      card.className = "tpl " + s.kind;
      const p = document.createElement("div");
      p.className = "tpltext";
      p.textContent = t;
      card.appendChild(p);
      const hint = document.createElement("span");
      hint.className = "copyhint";
      hint.textContent = "ক্লিক করে copy";
      card.appendChild(hint);
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
  if (!LIB) {
    try {
      LIB = await (await authFetch("/api/templates")).json();
    } catch {
      $("libList").textContent = "টেমপ্লেট লোড করা যায়নি।";
      return;
    }
    buildChips();
    $("q").addEventListener("input", renderLib);
  }
  renderLib();
}

function showTab(which) {
  const lib = which === "lib";
  document.querySelector(".layout").classList.toggle("hidden", lib);
  $("viewLib").classList.toggle("hidden", !lib);
  $("tabCheck").classList.toggle("active", !lib);
  $("tabLib").classList.toggle("active", lib);
  if (lib) openLib();
}
$("tabCheck").addEventListener("click", () => showTab("check"));
$("tabLib").addEventListener("click", () => showTab("lib"));

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
    showApp();
  } catch (err) {
    showLogin("❌ " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Login";
  }
});

$("logout").addEventListener("click", () => {
  setToken(null); LIB = null;
  form.reset(); updateVisibility(); showEmpty(); showTab("check");
  showLogin("");
});

(async function boot() {
  if (!getToken()) { showLogin(""); return; }
  try {
    const r = await fetch("/api/me", { headers: { Authorization: "Bearer " + getToken() } });
    if (r.ok) showApp(); else { setToken(null); showLogin(""); }
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
