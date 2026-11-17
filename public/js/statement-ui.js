/* statement-ui.js - the Statement tab. Reads the PDF locally; only derived numbers go to the check form. */
(function (root) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let app = null, last = null;

  const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  function status(t) { $("stStatus").textContent = t; }
  function reset() {
    last = null;
    if (!$("stOut")) return;
    $("stOut").innerHTML = "";
    ["stCust", "stApp", "stCph", "stGph", "stFile"].forEach((i) => { $(i).value = ""; });
    status("");
  }

  function render(a, appDate) {
    const out = $("stOut");
    out.innerHTML = "";
    const card = el("div", "card");
    card.appendChild(el("h3", "", "ফলাফল"));
    const warnUnv = el("p", "warn", "⚠️ Statement-এর row পড়ার পদ্ধতি এখনো আসল sample দিয়ে যাচাই করা হয়নি (" + a.provider.id + "). নিচের সংখ্যা PDF-এর সাথে চোখে মিলিয়ে নিন।");
    card.appendChild(warnUnv);

    if (a.name) {
      const t = a.name.level === "match" ? "✅ নাম মিলেছে" : a.name.level === "partial" ? "⚠️ নাম আংশিক মিলেছে" : "❌ নাম মেলেনি";
      card.appendChild(el("p", "", `${t} — Statement-এ: "${a.holder}"`));
    } else card.appendChild(el("p", "muted", a.holder ? "Customer-এর নাম দিলে নাম মিলিয়ে দেখা হবে।" : "Statement থেকে account-holder-এর নাম পাওয়া যায়নি।"));

    card.appendChild(el("p", "", `Row পাওয়া গেছে: ${a.rows}টি (পড়তে না পারা: ${a.skipped}টি)। তারিখের সীমা: শেষ ${a.sop.excluded} দিন বাদ (${a.sop.cutoff}-এর পরের লেনদেন ধরা হয়নি)।`));
    const tb = el("table", "stt");
    const head = el("tr"); ["মাস", "Cash-in", "Cash-out", "লেনদেন"].forEach((h) => head.appendChild(el("th", "", h)));
    tb.appendChild(head);
    a.sop.months.forEach((m) => {
      const tr = el("tr");
      [m.month, fmt(m.in), fmt(m.out), m.count].forEach((v) => tr.appendChild(el("td", "", String(v))));
      tb.appendChild(tr);
    });
    card.appendChild(tb);
    card.appendChild(el("p", "", `সেরা মাস (cash-in বা cash-out, যোগ নয়): ৳${fmt(a.sop.best)} — ${a.sop.passMin ? "✅ ন্যূনতম লেনদেনের নিয়ম পূরণ (tolerance সহ)" : "❌ ন্যূনতম লেনদেনের নিয়ম পূরণ হয়নি"}${a.sop.passFast ? " · 🔒 ৬,০০০+ (fast-track)" : ""}`));
    card.appendChild(el("p", "", `৩ মাসের মোট (in+out): ৳${fmt(a.sop.total3)} · ${a.sop.covered}/৩ মাসে লেনদেন আছে`));

    card.appendChild(el("h4", "", "Authenticity ইঙ্গিত (প্রমাণ নয়)"));
    const ul = el("ul");
    a.signals.forEach((s) => ul.appendChild(el("li", "sig " + s.level, (s.level === "warn" ? "⚠️ " : s.level === "ok" ? "✔ " : "ℹ️ ") + s.text)));
    card.appendChild(ul);
    card.appendChild(el("p", "muted", "সীমাবদ্ধতা: নিখুঁত জাল statement এই পদ্ধতিতে ধরা যায় না; আসল statement-ও কখনো সতর্কতা দিতে পারে। চূড়ান্ত সিদ্ধান্ত আপনার।"));

    const use = el("button", "primary", "⬇ এই সংখ্যাগুলো Check form-এ বসান");
    use.type = "button";
    use.addEventListener("click", () => {
      app.setFields({ tx_1_month: Math.round(a.sop.best), tx_3_month: Math.round(a.sop.total3), stmt_months_covered: a.sop.covered });
      app.showCheck();
    });
    card.appendChild(use);
    out.appendChild(card);
  }

  async function run() {
    const f = $("stFile").files[0];
    if (!f) { status("⚠️ আগে PDF বাছুন।"); return; }
    if (f.size > 15 * 1024 * 1024) { status("⚠️ PDF খুব বড় (১৫ MB-এর বেশি)।"); return; }
    const app0 = $("stApp").value || (function () { const t = app.today(); return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`; })();
    const pws = [$("stCph").value.trim(), $("stGph").value.trim()];
    $("stRun").disabled = true; status("পড়া হচ্ছে… (শুধু এই browser-এ)");
    try {
      const { lines, meta } = await root.TPStmtPdf.extract(await f.arrayBuffer(), pws);
      const p = app.policy();
      const cfg = { minMonth: p.min_month_tx, fastTrack: p.fast_track_tx, tolerance: p.money_tolerance, months: p.statement_months, excludeLastDays: p.exclude_last_days };
      const a = root.TPStmt.analyze({ lines, meta, customerName: $("stCust").value.trim(), appDate: app0, cfg });
      last = a;
      render(a, app0);
      status("✅ হয়ে গেছে।");
    } catch (e) { status("❌ " + e.message); }
    finally { $("stRun").disabled = false; }
  }

  function init(a) { app = a; $("stRun").addEventListener("click", run); }
  root.TPStmtUI = { init, reset };
})(window);
