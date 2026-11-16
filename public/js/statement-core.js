/* statement-core.js - PURE logic for the Statement Checker. No DOM, no network, no storage.
   Works in the browser (window.TPStmt) and in node (module.exports) so the Chrome extension and the tests reuse it.

   HONEST LIMITS
   - Row parsing is GENERIC (date + amounts on a line). Provider profiles are marked verified:false until real
     sample statements are tested. Always compare the numbers with the PDF by eye before trusting them.
   - Authenticity signals are hints, never proof. A careful forger leaves none of them; a real statement can trip some.
   - Scanned (image-only) PDFs have no text; OCR is not included. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TPStmt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CONFIG = { minMonth: 2000, fastTrack: 6000, tolerance: 60, months: 3, excludeLastDays: 7 };

  /* ------------------------------------------------------------ names */
  const BN = { "অ":"o","আ":"a","ই":"i","ঈ":"i","উ":"u","ঊ":"u","ঋ":"ri","এ":"e","ঐ":"oi","ও":"o","ঔ":"ou",
    "া":"a","ি":"i","ী":"i","ু":"u","ূ":"u","ৃ":"ri","ে":"e","ৈ":"oi","ো":"o","ৌ":"ou",
    "ক":"k","খ":"kh","গ":"g","ঘ":"gh","ঙ":"ng","চ":"ch","ছ":"ch","জ":"j","ঝ":"jh","ঞ":"n","ট":"t","ঠ":"th","ড":"d","ঢ":"dh","ণ":"n",
    "ত":"t","থ":"th","দ":"d","ধ":"dh","ন":"n","প":"p","ফ":"f","ব":"b","ভ":"v","ম":"m","য":"j","র":"r","ল":"l","শ":"sh","ষ":"sh","স":"s","হ":"h",
    "ড়":"r","ঢ়":"r","য়":"y","ৎ":"t","ং":"ng","ঃ":"","ঁ":"","্":"" };
  const TITLES = new Set(["md", "mohammad", "muhammad", "mohammed", "mohd", "mst", "mrs", "mr", "ms", "miss", "sk", "sheikh", "begum", "akter", "akhter"]);
  const TITLES_STRICT = new Set(["md", "mo", "mohd", "mst", "mrs", "mr", "ms", "miss"]);

  function translit(s) {
    let out = "";
    for (const ch of s.normalize("NFD")) out += (ch in BN ? BN[ch] : ch);
    return out;
  }
  function nameTokens(s) {
    const t = translit(String(s || "")).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    return t.filter((w) => !TITLES_STRICT.has(w));
  }
  const vowelless = (w) => w.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
  function lev(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  // do two single name words refer to the same word? (spelling variants, initials)
  function wordMatch(a, b) {
    if (a === b) return 1;
    if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.6 : 0;      // initial
    if (vowelless(a) === vowelless(b) && vowelless(a).length >= 2) return 0.9;   // mohammad / muhammad, rahman / rahaman
    const d = lev(a, b);
    if (d <= 1 && Math.min(a.length, b.length) >= 4) return 0.85;
    if (d <= 2 && Math.min(a.length, b.length) >= 7) return 0.75;
    return 0;
  }
  /* nameMatch("MD. FOKRUL HASAN", "Fokrul Hasan") -> {ok, score, level}  level: match | partial | mismatch */
  function nameMatch(a, b) {
    const A = nameTokens(a), B = nameTokens(b);
    if (!A.length || !B.length) return { ok: false, score: 0, level: "mismatch" };
    const [short, long] = A.length <= B.length ? [A, B] : [B, A];
    const used = new Set();
    let sum = 0;
    for (const w of short) {
      let best = 0, bi = -1;
      long.forEach((x, i) => { if (used.has(i)) return; const s = wordMatch(w, x); if (s > best) { best = s; bi = i; } });
      if (bi >= 0) used.add(bi);
      sum += best;
    }
    const score = Math.round((sum / short.length) * 100) / 100;
    const level = score >= 0.85 ? "match" : score >= 0.5 ? "partial" : "mismatch";
    return { ok: level === "match", score, level };
  }

  /* ------------------------------------------------------------ amounts & dates */
  function toAscii(s) { return String(s).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d)); }
  function parseAmount(s) {
    const t = toAscii(s).replace(/[,\s৳]|tk|bdt/gi, "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
    return Number(t);
  }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const iso = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  };
  const DATE_RES = [
    [/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/, (m) => iso(+m[1], +m[2], +m[3])],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/, (m) => iso(+m[3], +m[2], +m[1])],                      // DD/MM/YYYY (Bangladesh)
    [/\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(\d{4})\b/, (m) => (MON[m[2].toLowerCase()] ? iso(+m[3], MON[m[2].toLowerCase()], +m[1]) : null)],
  ];
  /* returns {date:'YYYY-MM-DD', rest:'line without the date/time'} or null */
  function findDate(line) {
    const s = toAscii(line);
    for (const [re, fn] of DATE_RES) {
      const m = re.exec(s);
      if (m) { const d = fn(m); if (d) return { date: d, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*([AP]M)?/gi, " ") }; }
    }
    return null;
  }

  /* ------------------------------------------------------------ rows */
  const IN_WORDS = /(cash\s*in|received|receive|deposit|add\s*money|credit|cr\b|salary|incoming|from\s|refund|cash-in|ক্যাশ\s*ইন|জমা)/i;
  const OUT_WORDS = /(cash\s*out|send\s*money|payment|withdraw|debit|dr\b|transfer\s*to|recharge|bill|purchase|cash-out|ক্যাশ\s*আউট|উত্তোলন|পেমেন্ট)/i;

  const MONEY_RE = /-?\d[\d,]*\.\d{1,2}|-?\d{1,3}(?:,\d{3})+|-?\d+/g;
  function lineAmounts(rest) {
    return (rest.match(MONEY_RE) || []).map(parseAmount).filter((v) => v !== null);
  }
  /* one text line -> {date, amounts, text} or null. A row needs a date and at least one amount. */
  function parseLine(line) {
    const f = findDate(line);
    if (!f) return null;
    // drop long id-like digit runs (transaction ids, phone numbers) before reading amounts
    const rest = f.rest.replace(/\b[A-Za-z0-9]{8,}\b/g, " ").replace(/\b0?1\d{9,10}\b/g, " ");
    const amounts = lineAmounts(rest);
    if (!amounts.length) return null;
    return { date: f.date, amounts, text: line };
  }

  /* lines -> rows [{date, in, out, balance|null, dir}]. Direction comes from the balance change when the
     statement has a running balance, otherwise from words. Rows we cannot place are returned in `skipped`. */
  function parseRows(lines) {
    const raw = lines.map(parseLine).filter(Boolean);
    const rows = [], skipped = [];
    let prevBal = null;
    for (const r of raw) {
      let amount, balance = null, dir = null;
      const a = r.amounts;
      if (a.length >= 2) { amount = Math.abs(a[a.length - 2]); balance = a[a.length - 1]; }
      else amount = Math.abs(a[0]);
      if (balance !== null && prevBal !== null) {
        const dIn = Math.abs(prevBal + amount - balance), dOut = Math.abs(prevBal - amount - balance);
        if (dIn < 0.011 && dOut >= 0.011) dir = "in"; else if (dOut < 0.011 && dIn >= 0.011) dir = "out";
      }
      if (!dir) {
        const i = IN_WORDS.test(r.text), o = OUT_WORDS.test(r.text);
        if (i && !o) dir = "in"; else if (o && !i) dir = "out";
      }
      if (balance !== null) prevBal = balance;
      if (!dir) { skipped.push(r.text); continue; }
      rows.push({ date: r.date, in: dir === "in" ? amount : 0, out: dir === "out" ? amount : 0, balance, dir });
    }
    return { rows, skipped };
  }

  /* ------------------------------------------------------------ SOP money check */
  function addDays(isoDate, n) { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function monthKey(isoDate) { return isoDate.slice(0, 7); }
  function prevMonths(appIso, n) {
    let y = +appIso.slice(0, 4), m = +appIso.slice(5, 7);
    const out = [];
    for (let i = 0; i < n; i++) { m -= 1; if (m === 0) { m = 12; y -= 1; } out.unshift(`${y}-${String(m).padStart(2, "0")}`); }
    return out;
  }
  /* The 3 calendar months before the application month; rows in the last 7 days before the application are ignored.
     best = the biggest single month where cash-in OR cash-out counts (NOT in+out added).
     total3 = in+out of all 3 months (only used for the MRP >= 50,000 rule). */
  function sopCheck(rows, appIso, cfg) {
    const c = Object.assign({}, CONFIG, cfg || {});
    const months = prevMonths(appIso, c.months);
    const cutoff = addDays(appIso, -c.excludeLastDays);
    const per = Object.fromEntries(months.map((k) => [k, { month: k, in: 0, out: 0, count: 0 }]));
    for (const r of rows) {
      if (r.date > cutoff) continue;
      const p = per[monthKey(r.date)];
      if (p) { p.in += r.in; p.out += r.out; p.count++; }
    }
    const list = months.map((k) => per[k]);
    const best = Math.max(0, ...list.map((p) => Math.max(p.in, p.out)));
    const dates = rows.map((r) => r.date).sort();
    const covered = list.filter((p) => p.count > 0).length;
    return {
      months: list, best, total3: list.reduce((s, p) => s + p.in + p.out, 0), covered,
      passMin: best >= c.minMonth - c.tolerance, passFast: best >= c.fastTrack - c.tolerance,
      first: dates[0] || null, last: dates[dates.length - 1] || null, cutoff,
    };
  }

  /* ------------------------------------------------------------ authenticity signals */
  /* balance arithmetic: each row's balance must equal previous balance +/- amount. Rows may be oldest-first or newest-first. */
  function balanceCheck(rows) {
    const withBal = rows.filter((r) => r.balance !== null);
    if (withBal.length < 3) return { checked: 0, broken: 0 };
    const asc = withBal[0].date <= withBal[withBal.length - 1].date;
    const seq = asc ? withBal : withBal.slice().reverse();
    let checked = 0, broken = 0;
    for (let i = 1; i < seq.length; i++) {
      checked++;
      const exp = seq[i - 1].balance + seq[i].in - seq[i].out;
      if (Math.abs(exp - seq[i].balance) > 0.011) broken++;
    }
    return { checked, broken };
  }
  const EDITORS = /(photoshop|illustrator|canva|ilovepdf|smallpdf|sejda|pdfescape|pdf24|foxit phantom|acrobat|word|libreoffice|writer|wps|nitro|pdfelement|master pdf|pdf-xchange|pdfsam|pdfcandy|sodapdf|online|fake|gimp|inkscape|affinity)/i;
  const GENUINE_HINT = /(bkash|nagad|rocket|dutch|bangla|bank|jasper|itext|crystal|ireport|birt|apache fop|wkhtml|reportlab|pdfkit|dompdf|tcpdf|mpdf|fpdf|chrome|skia|prince)/i;

  function pdfDate(s) {
    const m = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))) : null;
  }
  /* meta: {producer, creator, creationDate, modDate, revisions, pages, images, fonts, encrypted}
     returns [{level:'warn'|'info'|'ok', text}] - hints only */
  function signals(meta, rows, bal) {
    const out = [];
    const m = meta || {};
    const tool = `${m.producer || ""} ${m.creator || ""}`.trim();
    if (tool && EDITORS.test(tool) && !GENUINE_HINT.test(tool)) out.push({ level: "warn", text: `PDF বানানো/বদলানো হয়েছে এই tool-এ: "${tool}" — সাধারণ editor/converter, statement system এর generator নয়।` });
    else if (tool) out.push({ level: "info", text: `PDF generator: "${tool}"` });
    else out.push({ level: "info", text: "PDF-এ producer তথ্য নেই (metadata মুছে ফেলা হতে পারে, আবার সাধারণও হতে পারে)।" });
    const c = pdfDate(m.creationDate), d = pdfDate(m.modDate);
    if (c && d && Math.abs(d - c) > 120000) out.push({ level: "warn", text: "PDF তৈরির পর পরে আবার বদলানো (modified) হয়েছে — metadata-র তারিখ আলাদা।" });
    if (m.revisions > 1) out.push({ level: "warn", text: `PDF-এ ${m.revisions}টি save-revision আছে — তৈরির পর edit হয়ে থাকতে পারে।` });
    if (bal && bal.checked >= 3) {
      if (bal.broken > 0) out.push({ level: "warn", text: `Balance হিসাব মেলেনি ${bal.broken}/${bal.checked} জায়গায় (আগের balance ± amount ≠ নতুন balance)। Edit হয়ে থাকতে পারে, অথবা row পড়তে ভুল হয়েছে — PDF চোখে দেখুন।` });
      else out.push({ level: "ok", text: `Balance হিসাব ${bal.checked}টি row-তে ঠিকঠাক মিলেছে।` });
    } else if (rows && rows.length) out.push({ level: "info", text: "Running balance পাওয়া যায়নি, তাই balance-এর হিসাব যাচাই করা যায়নি।" });
    if (m.images > 0) out.push({ level: "info", text: `PDF-এ ${m.images}টি image আছে (logo সাধারণ; লেনদেনের অংশ image হলে সন্দেহজনক)।` });
    if (m.textChars !== undefined && m.textChars < 40) out.push({ level: "warn", text: "PDF-এ প্রায় কোনো লেখা নেই — scan/ছবি হতে পারে। OCR এই tool-এ নেই, তাই হিসাব করা যায়নি।" });
    return out;
  }

  /* ------------------------------------------------------------ holder name from header lines */
  const NAME_LABEL = /(account\s*name|customer\s*name|name\s*of\s*account|account\s*holder|holder\s*name|name|নাম)\s*[:\-]\s*(.+)$/i;
  function findHolderName(lines) {
    for (const l of lines.slice(0, 40)) {
      const m = NAME_LABEL.exec(toAscii(l).trim());
      if (m) { const n = m[2].replace(/\s{2,}.*/, "").trim(); if (n && n.length >= 3) return n; }
    }
    return null;
  }
  /* Provider profiles. verified:false = written from general knowledge, NOT tested on real statements. */
  const PROVIDERS = [
    { id: "bkash", re: /bkash/i, verified: false }, { id: "nagad", re: /nagad/i, verified: false },
    { id: "rocket", re: /rocket|dutch[\s-]*bangla/i, verified: false }, { id: "bank", re: /bank/i, verified: false },
  ];
  function detectProvider(lines) {
    const head = lines.slice(0, 30).join(" ");
    return PROVIDERS.find((p) => p.re.test(head)) || { id: "unknown", verified: false };
  }

  /* ------------------------------------------------------------ whole analysis */
  /* input: {lines, meta, customerName, appDate:'YYYY-MM-DD'} -> everything the UI shows. No personal data is kept anywhere. */
  function analyze(input) {
    const lines = input.lines || [];
    const { rows, skipped } = parseRows(lines);
    const sop = sopCheck(rows, input.appDate);
    const bal = balanceCheck(rows);
    const holder = findHolderName(lines);
    const provider = detectProvider(lines);
    return {
      provider, holder,
      name: input.customerName && holder ? nameMatch(input.customerName, holder) : null,
      rows: rows.length, skipped: skipped.length, sop, balance: bal,
      signals: signals(input.meta, rows, bal),
    };
  }

  return { CONFIG, nameMatch, parseAmount, findDate, parseLine, parseRows, sopCheck, balanceCheck, signals, findHolderName, detectProvider, analyze, prevMonths, addDays };
});
