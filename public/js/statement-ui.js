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
    ["stCust", "stGuar", "stRel", "stApp", "stCph", "stGph", "stCustFather", "stCustMother", "stGuarFather", "stGuarMother", "stGuarHusband", "stSpouseProof", "stFile"].forEach((i) => { if ($(i)) $(i).value = ""; });
    status("");
  }

  function render(a) {
    const out = $("stOut");
    out.innerHTML = "";
    const card = el("div", "card");
    card.appendChild(el("h3", "", `ফলাফল (${a.provider.id.toUpperCase()})`));

    if (!a.isFullCheck) {
      card.appendChild(el("p", "warn", "ℹ️ Bank Statement: শুধুমাত্র লেনদেনের টাকা-পয়সা অটো যাচাই করা হয়েছে — অ্যাকাউন্ট হোল্ডারের নাম ও PDF authenticity চোখে মিলিয়ে নিন।"));
    }

    if (a.forbiddenHits && a.forbiddenHits.length > 0) {
      const labels = a.forbiddenHits.map((x) => x.label).join(", ");
      card.appendChild(el("p", "warn", `⚠️ লোন অ্যাপ লেনদেন পাওয়া গেছে (ACTION REQUIRED — অ্যাপের স্ক্রিনশট চাইতে হবে): ${labels}`));
    }

    card.appendChild(el("p", a.holderCheck.returnTid ? "sig high" : "", a.holderCheck.text));
    if (a.holderCheck.status === "ok_customer") {
      card.appendChild(el("p", "sig ok", "📞 Customer Statement মিলেছে — Guarantor-কে শুধু Missed Call দিলেই হবে।"));
    }
    if (a.relationCheck && a.relationCheck.text) {
      card.appendChild(el("p", a.relationCheck.ok === false ? "sig high" : "", a.relationCheck.text));
    }

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

    card.appendChild(el("p", "", `📌 MRP < ৳৫০,০০০ হলে (যেকোনো ১ মাসে Debit + Credit (Cash-in + Cash-out) মিলিয়ে ≥ ৳২,০০০): সেরা মাস ৳${fmt(a.sop.best)} — ${a.sop.passMin ? "✅ পাস (মাঝের মাসে লেনদেন না থাকলেও চলবে)" : "❌ পাস হয়নি"}${a.sop.passFast ? " · ⚡ ৬,০০০+ (Fast-track)" : ""}`));
    card.appendChild(el("p", "", `📌 MRP ≥ ৳৫০,০০০ হলে (৩ মাসের মোট Cash-in + Cash-out ≥ ৳১৫,০০০): ৩ মাসের মোট ৳${fmt(a.sop.total3)} — ${a.sop.passHighMrp15k ? "✅ ১৫,০০০+ পাস" : "❌ ১৫,০০০ হয়নি"}${a.sop.passHighMrpExempt30k ? " · ⭐ ৩০,০০০+ (Job ID/License ছাড়)" : ""} · স্টেটমেন্ট কভার: ${a.sop.covered}/৩ মাস`));

    card.appendChild(el("h4", "", a.isFullCheck ? "Authenticity ও ফন্ট যাচাই (bKash / Nagad)" : "Bank Statement নোট"));
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
      fields.name_mismatch = a.holderCheck.status === "ok_guarantor_fb";
      if (fields.name_mismatch) {
        const rel = $("stRel") ? $("stRel").value : "";
        if (rel) fields.guarantor_relation = rel;
      }
      app.setFields(fields);
      if (a.forbiddenHits && a.forbiddenHits.length > 0) {
        a.forbiddenHits.forEach((hit) => app.addManual(hit.tid || "adr.11", "action"));
      }
      if (a.holderCheck.returnTid) {
        app.addManual(a.holderCheck.returnTid, "return");
      } else if (a.relationCheck && a.relationCheck.returnTid) {
        app.addManual(a.relationCheck.returnTid, "return");
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
        customerFather: $("stCustFather") ? $("stCustFather").value.trim() : "",
        customerMother: $("stCustMother") ? $("stCustMother").value.trim() : "",
        guarantorFather: $("stGuarFather") ? $("stGuarFather").value.trim() : "",
        guarantorMother: $("stGuarMother") ? $("stGuarMother").value.trim() : "",
        guarantorHusband: $("stGuarHusband") ? $("stGuarHusband").value.trim() : "",
        spouseProof: $("stSpouseProof") ? $("stSpouseProof").value : "",
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
