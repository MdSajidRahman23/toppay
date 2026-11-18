/* statement-ui.js - the Statement tab. Reads the PDF locally; only derived numbers/flags go to the check form. */
(function (root) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let app = null;

  const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function status(t) { $("stStatus").textContent = t; }
  function reset() {
    if (!$("stOut")) return;
    $("stOut").innerHTML = "";
    ["stCust", "stGuar", "stRel", "stApp", "stCph", "stGph", "stFile"].forEach((i) => { if ($(i)) $(i).value = ""; });
    status("");
  }

  function render(a) {
    const out = $("stOut");
    out.innerHTML = "";
    const card = el("div", "card");
    card.appendChild(el("h3", "", `ফলাফল (${a.provider.id.toUpperCase()})`));

    if (!a.provider.verified) {
      card.appendChild(el("p", "warn", "⚠️ " + a.provider.id.toUpperCase() + " স্টেটমেন্টের ক্ষেত্রে শুধু নাম ও টাকার হিসাব যাচাই করা হয়েছে — PDF চোখে মিলিয়ে নিন।"));
    }

    if (a.forbiddenHits && a.forbiddenHits.length > 0) {
      const labels = a.forbiddenHits.map((x) => x.label).join(", ");
      card.appendChild(el("p", "sig high", `🚨 RETURN (bKash নিষিদ্ধ লেনদেন/শব্দ পাওয়া গেছে): ${labels} — আবেদন RETURN হবে।`));
    }

    card.appendChild(el("p", a.holderCheck.returnTid ? "sig high" : "", a.holderCheck.text));

    card.appendChild(el("p", "", `লেনদেন পাওয়া গেছে: ${a.rows}টি (পড়তে না পারা: ${a.skipped}টি)। শেষ ${a.sop.excluded} দিন বাদ (${a.sop.cutoff}-এর পরের লেনদেন ধরা হয়নি)।`));

    const tb = el("table", "stt");
    const head = el("tr");
    ["মাস", "Cash-in", "Cash-out", "মোট (In+Out)", "লেনদেন"].forEach((h) => head.appendChild(el("th", "", h)));
    tb.appendChild(head);
    a.sop.months.forEach((m) => {
      const tr = el("tr");
      [m.month, fmt(m.in), fmt(m.out), fmt(m.in + m.out), m.count].forEach((v) => tr.appendChild(el("td", "", String(v))));
      tb.appendChild(tr);
    });
    card.appendChild(tb);

    card.appendChild(el("p", "", `📌 MRP < ৳৫০,০০০ হলে (যেকোনো ১ মাসে এককভাবে Cash-in বা Cash-out ≥ ৳২,০০০): সেরা মাস ৳${fmt(a.sop.best)} — ${a.sop.passMin ? "✅ পাস (মাঝের মাসে লেনদেন না থাকলেও চলবে)" : "❌ পাস হয়নি"}${a.sop.passFast ? " · ⚡ ৬,০০০+ (Fast-track)" : ""}`));
    card.appendChild(el("p", "", `📌 MRP ≥ ৳৫০,০০০ হলে (৩ মাসের মোট Cash-in + Cash-out ≥ ৳১৫,০০০): ৩ মাসের মোট ৳${fmt(a.sop.total3)} — ${a.sop.passHighMrp15k ? "✅ ১৫,০০০+ পাস" : "❌ ১৫,০০০ হয়নি"}${a.sop.passHighMrpExempt30k ? " · ⭐ ৩০,০০০+ (Job ID/License ছাড়)" : ""} · স্টেটমেন্ট কভার: ${a.sop.covered}/৩ মাস`));

    card.appendChild(el("h4", "", "Authenticity ও ফন্ট যাচাই (bKash)"));
    const ul = el("ul");
    a.signals.forEach((s) => ul.appendChild(el("li", "sig " + s.level, (s.level === "warn" ? "⚠️ " : s.level === "ok" ? "✔ " : "ℹ️ ") + s.text)));
    card.appendChild(ul);

    const use = el("button", "primary", "⬇ এই ফলাফল Check form-এ বসান");
    use.type = "button";
    use.addEventListener("click", () => {
      const fields = {
        tx_1_month: Math.round(a.sop.best),
        tx_3_month: Math.round(a.sop.total3),
        stmt_months_covered: a.sop.covered,
      };
      if (a.holderCheck.status === "ok_guarantor_fb") {
        fields.name_mismatch = true;
        const rel = $("stRel") ? $("stRel").value : "";
        if (rel) fields.guarantor_relation = rel;
      }
      if (a.forbiddenHits && a.forbiddenHits.length > 0) {
        fields.palmpay_overdue = true;
      }
      app.setFields(fields);
      if (a.holderCheck.returnTid) {
        app.addManual(a.holderCheck.returnTid, "return");
      }
      app.showCheck();
    });
    card.appendChild(use);
    out.appendChild(card);
  }

  async function run() {
    const f = $("stFile").files[0];
    if (!f) { status("⚠️ আগে PDF বাছুন।"); return; }
    if (f.size > 15 * 1024 * 1024) { status("⚠️ PDF খুব বড় (১৫ MB-এর বেশি)।"); return; }
    const app0 = $("stApp").value || (function () {
      const t = app.today();
      return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
    })();
    const pws = [$("stCph").value.trim(), $("stGph") ? $("stGph").value.trim() : ""];
    $("stRun").disabled = true;
    status("পড়া হচ্ছে… (শুধু এই browser-এ)");
    try {
      const { lines, structuredRows, meta } = await root.TPStmtPdf.extract(await f.arrayBuffer(), pws);
      const p = app.policy();
      const cfg = {
        minMonth: p.min_month_tx,
        fastTrack: p.fast_track_tx,
        highMrp: p.high_mrp,
        highMrpTx3: p.high_mrp_tx3,
        tx3Exempt: p.tx3_exempt,
        tolerance: p.money_tolerance,
        months: p.statement_months,
        excludeLastDays: p.exclude_last_days,
      };
      const a = root.TPStmt.analyze({
        lines,
        structuredRows,
        meta,
        customerName: $("stCust").value.trim(),
        guarantorName: $("stGuar") ? $("stGuar").value.trim() : "",
        guarantorRelation: $("stRel") ? $("stRel").value : "",
        appDate: app0,
        cfg,
      });
      render(a);
      status(meta.unlockedWith ? `✅ হয়ে গেছে (পাসওয়ার্ড দিয়ে আনলক হয়েছে)।` : "✅ হয়ে গেছে।");
    } catch (e) {
      status("❌ " + e.message);
    } finally {
      $("stRun").disabled = false;
    }
  }

  function init(a) {
    app = a;
    $("stRun").addEventListener("click", run);
    $("stFile").addEventListener("change", () => {
      if ($("stFile").files && $("stFile").files[0]) run();
    });
    if (root.TPStmtInitData && typeof root.TPStmtInitData === "object") {
      ["stCust", "stGuar", "stRel", "stCph", "stGph"].forEach((k) => {
        if (root.TPStmtInitData[k] && $(k)) $(k).value = root.TPStmtInitData[k];
      });
    }
  }
  root.TPStmtUI = { init, reset };
})(window);
