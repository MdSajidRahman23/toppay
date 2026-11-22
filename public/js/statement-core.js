/* statement-core.js - PURE logic for the Statement Checker. No DOM, no network, no storage. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TPStmt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CONFIG = {
    minMonth: 2000,
    fastTrack: 6000,
    highMrp: 50000,
    highMrpTx3: 15000,
    tx3Exempt: 30000,
    tolerance: 60,
    months: 3,
    excludeLastDays: 7,
  };

  const FIRST_BLOOD = new Set(["father", "mother", "son", "daughter", "brother", "sister"]);
  const ALLOWED_GUARANTOR_RELATIONS = new Set(["father", "mother", "son", "daughter", "brother", "sister", "spouse"]);

  /* ------------------------------------------------------------ names */
  const BN = {
    "অ":"o","আ":"a","ই":"i","ঈ":"i","উ":"u","ঊ":"u","ঋ":"ri","এ":"e","ঐ":"oi","ও":"o","ঔ":"ou",
    "া":"a","ি":"i","ী":"i","ু":"u","ূ":"u","ৃ":"ri","ে":"e","ৈ":"oi","ো":"o","ৌ":"ou",
    "ক":"k","খ":"kh","গ":"g","ঘ":"gh","ঙ":"ng","চ":"ch","ছ":"ch","জ":"j","ঝ":"jh","ঞ":"n","ট":"t","ঠ":"th","ড":"d","ঢ":"dh","ণ":"n",
    "ত":"t","থ":"th","দ":"d","ধ":"dh","ন":"n","প":"p","ফ":"f","ব":"b","ভ":"v","ম":"m","য":"j","র":"r","ল":"l","শ":"sh","ষ":"sh","স":"s","হ":"h",
    "ড়":"r","ঢ়":"r","য়":"y","ৎ":"t","ং":"ng","ঃ":"","ঁ":"","্":""
  };
  const TITLES_STRICT = new Set(["md", "mo", "mohd", "mst", "mrs", "mr", "ms", "miss", "late", "alhaj", "haji"]);

  function translit(s) {
    let out = "";
    for (const ch of String(s || "").normalize("NFD")) out += (ch in BN ? BN[ch] : ch);
    return out;
  }
  function nameTokens(s) {
    const cleaned = String(s || "")
      .replace(/মোঃ|মোসাঃ|মোসা\.|মো\.|মিসেস|মিস্টার|মিঃ|মৃত/g, " ");
    const t = translit(cleaned).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
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

  /* Strict bKash / Nagad username vs NID name match:
     - Honorific titles (Md, Mst, Mrs, Mr, Ms, Miss, etc.) are ignored.
     - Passes ONLY if total alphabet mismatch across the name is <= 1.
     - If > 1 alphabet mismatches, returns { ok: false, level: "mismatch", diff, problem } explaining exact issue. */
  function strictNameMatch(nidName, stmtName) {
    const A = nameTokens(nidName);
    const B = nameTokens(stmtName);
    if (!A.length || !B.length) {
      return { ok: false, score: 0, level: "mismatch", diff: 99, problem: "নাম পাওয়া যায়নি।" };
    }

    const pairs = [];
    const usedA = new Set();
    const usedB = new Set();
    const allEdges = [];
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B.length; j++) {
        allEdges.push({ i, j, d: lev(A[i], B[j]) });
      }
    }
    allEdges.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
    for (const e of allEdges) {
      if (usedA.has(e.i) || usedB.has(e.j)) continue;
      usedA.add(e.i);
      usedB.add(e.j);
      pairs.push({ nidWord: A[e.i], stmtWord: B[e.j], d: e.d });
    }

    const missingInStmt = A.filter((_, i) => !usedA.has(i));
    const extraInStmt = B.filter((_, j) => !usedB.has(j));

    let totalAlphabetDiff = pairs.reduce((s, p) => s + p.d, 0);
    for (const w of missingInStmt) totalAlphabetDiff += w.length;
    for (const w of extraInStmt) totalAlphabetDiff += w.length;

    if (totalAlphabetDiff <= 1) {
      const note = totalAlphabetDiff === 1
        ? (() => {
            const p = pairs.find((x) => x.d === 1);
            return p ? `১টি অক্ষর অমিল ("${p.stmtWord}" ↔ "${p.nidWord}") — অনুমোদিত` : "১টি অক্ষর অমিল — অনুমোদিত";
          })()
        : null;
      return {
        ok: true,
        score: totalAlphabetDiff === 0 ? 1 : 0.95,
        level: "match",
        diff: totalAlphabetDiff,
        note,
        problem: null,
      };
    }

    const problems = [];
    for (const p of pairs) {
      if (p.d > 0) {
        problems.push(`"${p.stmtWord}" বনাম NID-তে "${p.nidWord}" (${p.d}টি অক্ষর ভিন্ন)`);
      }
    }
    if (missingInStmt.length) {
      problems.push(`NID-র "${missingInStmt.join(" ")}" অংশটি Statement-এ নেই`);
    }
    if (extraInStmt.length) {
      problems.push(`Statement-এ অতিরিক্ত অংশ আছে: "${extraInStmt.join(" ")}"`);
    }

    const problemStr = `মোট ${totalAlphabetDiff}টি অক্ষর অমিল (সর্বোচ্চ ১টি অনুমোদিত): ${problems.join("; ")}`;
    return {
      ok: false,
      score: Math.max(0, Math.round((1 - totalAlphabetDiff / Math.max(A.join("").length, B.join("").length, 1)) * 100) / 100),
      level: "mismatch",
      diff: totalAlphabetDiff,
      problem: problemStr,
    };
  }

  /* Lenient name matching for family/relation NID checks (Father/Mother/Husband):
     - Ignores titles like Mrs, Mr, Mst, Md (e.g. "Mrs Sufia Begum" == "Sufia Begum").
     - Allows spelling differences ("banan vul hole problem nai"). */
  function relationWordMatch(a, b) {
    if (a === b) return 1;
    if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.75 : 0;
    if (vowelless(a) === vowelless(b) && vowelless(a).length >= 2) return 0.95;
    const d = lev(a, b);
    const maxL = Math.max(a.length, b.length);
    if (d <= 1) return 0.9;
    if (d <= 2 && maxL >= 5) return 0.85;
    if (d / maxL <= 0.34) return 0.8;
    return 0;
  }

  function relationNameMatch(a, b) {
    const A = nameTokens(a), B = nameTokens(b);
    if (!A.length || !B.length) return { ok: false, score: 0, level: "mismatch" };
    const [short, long] = A.length <= B.length ? [A, B] : [B, A];
    const used = new Set();
    let sum = 0;
    for (const w of short) {
      let best = 0, bi = -1;
      long.forEach((x, i) => {
        if (used.has(i)) return;
        const s = relationWordMatch(w, x);
        if (s > best) { best = s; bi = i; }
      });
      if (bi >= 0) used.add(bi);
      sum += best;
    }
    const score = Math.round((sum / short.length) * 100) / 100;
    const ok = score >= 0.8;
    return { ok, score, level: ok ? "match" : "mismatch" };
  }

  function nameMatch(a, b) {
    return strictNameMatch(a, b);
  }

  /* Verify Customer & Guarantor Relationship rules */
  function verifyGuarantorRelation(opts) {
    const o = opts || {};
    const rel = String(o.relation || "").toLowerCase().trim();
    const stmtMismatch = Boolean(o.statementNameMismatch);
    const custName = String(o.customerName || "").trim();
    const custFather = String(o.customerFather || "").trim();
    const custMother = String(o.customerMother || "").trim();
    const guarName = String(o.guarantorName || "").trim();
    const guarFather = String(o.guarantorFather || "").trim();
    const guarMother = String(o.guarantorMother || "").trim();
    const guarHusband = String(o.guarantorHusband || "").trim();
    const spouseProof = String(o.spouseProof || "").trim();

    if (!rel) {
      return { status: "missing", ok: null, returnTid: null, text: "Guarantor-এর সম্পর্ক নির্বাচন করুন।" };
    }

    if (!ALLOWED_GUARANTOR_RELATIONS.has(rel)) {
      if (stmtMismatch) {
        return {
          status: "not_allowed",
          ok: false,
          returnTid: "stm.28",
          text: "❌ গ্রহণযোগ্য নয় (RETURN): Statement-এ Name Mismatch থাকলে রক্তের সম্পর্ক (Father, Mother, Son, Daughter, Brother, Sister) অথবা প্রমাণসহ Wife ছাড়া অন্য কারো Statement চলবে না।",
        };
      }
      const relLabels = { other_relative: "অন্য আত্মীয় / Cousin", friend: "বন্ধু (Friend)", colleague: "সহকর্মী (Colleague)" };
      return {
        status: "ok_guarantor_only",
        ok: true,
        returnTid: null,
        text: `✅ Guarantor হিসেবে "${relLabels[rel] || rel}" গ্রহণযোগ্য। (শুধুমাত্র Statement অন্য কারো নামে হলে First Blood / প্রমাণসহ Wife লাগবে; Customer-এর নিজের Statement হলে কোনো সমস্যা নেই।)`,
      };
    }

    if (rel === "father" || rel === "mother") {
      const label = rel === "father" ? "Father" : "Mother";
      const targetParent = rel === "father" ? custFather : custMother;
      if (!targetParent || !guarName) {
        return {
          status: "need_check",
          ok: null,
          returnTid: null,
          text: `ℹ️ ${label} যাচাই: Customer-এর NID-র ${label} নামের সাথে Guarantor-এর NID নাম মিলিয়ে দেখুন (বানান ভুল বা Mrs/Md থাকলে সমস্যা নেই)।`,
        };
      }
      const m = relationNameMatch(targetParent, guarName);
      if (m.ok) {
        return {
          status: "match",
          ok: true,
          returnTid: null,
          text: `✅ ${label} সম্পর্ক মিলেছে: Guarantor-এর নাম ("${guarName}") Customer-এর NID-র ${label} নামের ("${targetParent}") সাথে মিলেছে।`,
        };
      }
      return {
        status: "mismatch",
        ok: false,
        returnTid: "stm.28",
        text: `❌ ${label} নাম অমিল: Guarantor-এর NID নাম ("${guarName}") Customer-এর NID-র ${label} নামের ("${targetParent}") সাথে মেলেনি।`,
      };
    }

    if (rel === "son" || rel === "daughter") {
      const label = rel === "son" ? "Son" : "Daughter";
      if (!custName || (!guarFather && !guarMother)) {
        return {
          status: "need_check",
          ok: null,
          returnTid: null,
          text: `ℹ️ ${label} যাচাই: Customer-এর নাম Guarantor-এর NID-র Father অথবা Mother-এর জায়গায় আছে কিনা দেখুন (বানান ভুল বা Mrs/Md থাকলে সমস্যা নেই)।`,
        };
      }
      const mf = guarFather ? relationNameMatch(custName, guarFather) : { ok: false };
      const mm = guarMother ? relationNameMatch(custName, guarMother) : { ok: false };
      if (mf.ok || mm.ok) {
        const matchedSide = mf.ok ? `Father ("${guarFather}")` : `Mother ("${guarMother}")`;
        return {
          status: "match",
          ok: true,
          returnTid: null,
          text: `✅ ${label} সম্পর্ক মিলেছে: Customer-এর নাম ("${custName}") Guarantor-এর NID-র ${matchedSide}-এর সাথে মিলেছে।`,
        };
      }
      return {
        status: "mismatch",
        ok: false,
        returnTid: "stm.28",
        text: `❌ ${label} নাম অমিল: Customer-এর নাম ("${custName}") Guarantor-এর NID-র Father ("${guarFather || "—"}") বা Mother ("${guarMother || "—"}") কারো সাথে মেলেনি।`,
      };
    }

    if (rel === "spouse") {
      const custHusband = String(o.customerHusband || "").trim();
      if (custHusband && guarName) {
        const mch = relationNameMatch(custHusband, guarName);
        if (mch.ok) {
          return {
            status: "match",
            ok: true,
            returnTid: null,
            text: `✅ Spouse সম্পর্ক মিলেছে: Customer-এর NID-তে স্বামীর নাম ("${custHusband}") Guarantor-এর নামের ("${guarName}") সাথে মিলেছে।`,
          };
        }
      }
      if (guarHusband) {
        if (!custName) {
          return {
            status: "need_check",
            ok: null,
            returnTid: null,
            text: `ℹ️ Wife যাচাই: Wife-এর NID-তে স্বামীর নাম ("${guarHusband}") আছে — Customer-এর NID নামের সাথে মিলিয়ে দেখুন।`,
          };
        }
        const mh = relationNameMatch(custName, guarHusband);
        if (mh.ok) {
          return {
            status: "match",
            ok: true,
            returnTid: null,
            text: `✅ Wife সম্পর্ক মিলেছে: Wife-এর NID-তে স্বামীর নাম ("${guarHusband}") Customer-এর নামের ("${custName}") সাথে মিলেছে।`,
          };
        }
        return {
          status: "mismatch",
          ok: false,
          returnTid: "stm.16",
          text: `❌ Wife-এর NID-তে স্বামীর নাম অমিল: Wife-এর NID-তে স্বামীর নাম "${guarHusband}", কিন্তু Customer-এর নাম "${custName}"।`,
        };
      }
      if (spouseProof && spouseProof !== "none") {
        const proofLabel = {
          marriage_certificate: "Marriage Certificate",
          child_nid: "সন্তানের NID",
          qr_birth_certificate: "সন্তানের Birth Certificate",
        }[spouseProof] || spouseProof;
        return {
          status: "match_proof",
          ok: true,
          returnTid: null,
          text: `✅ Wife প্রমাণ সংযুক্ত (${proofLabel}): ডকুমেন্টে স্বামী-স্ত্রী উভয়ের নাম আছে কিনা নিশ্চিত হয়ে পাস দিন।`,
        };
      }
      return {
        status: "need_spouse_proof",
        ok: false,
        returnTid: "stm.16",
        text: "⚠️ Wife-এর NID-তে স্বামীর নাম নেই: Marriage Certificate অথবা তাদের সন্তানের NID / Birth Certificate চাইতে হবে (সেখানে স্বামী-স্ত্রী উভয়ের নাম আছে কিনা দেখতে হবে)।",
      };
    }

    if (rel === "brother" || rel === "sister") {
      const label = rel === "brother" ? "Brother" : "Sister";
      if ((!custFather && !custMother) || (!guarFather && !guarMother)) {
        return {
          status: "need_check",
          ok: null,
          returnTid: null,
          text: `ℹ️ ${label} যাচাই: Customer ও Guarantor দুজনের NID-তে বাবা ও মায়ের নাম একই আছে কিনা দেখুন (Mrs/Md বা বানান ভুল থাকলে সমস্যা নেই)।`,
        };
      }
      const fOk = custFather && guarFather ? relationNameMatch(custFather, guarFather).ok : null;
      const mOk = custMother && guarMother ? relationNameMatch(custMother, guarMother).ok : null;
      if (fOk === false || mOk === false) {
        const parts = [];
        if (fOk === false) parts.push(`পিতার নাম অমিল ("${custFather}" ≠ "${guarFather}")`);
        if (mOk === false) parts.push(`মাতার নাম অমিল ("${custMother}" ≠ "${guarMother}")`);
        return {
          status: "mismatch",
          ok: false,
          returnTid: "stm.28",
          text: `❌ ${label} সম্পর্ক অমিল: দুজনের বাবা-মায়ের নাম এক হতে হবে — ${parts.join(", ")}।`,
        };
      }
      if (fOk === true && mOk === true) {
        return {
          status: "match",
          ok: true,
          returnTid: null,
          text: `✅ ${label} সম্পর্ক মিলেছে: দুজনের বাবা ("${custFather}") ও মায়ের ("${custMother}") নাম একই আছে।`,
        };
      }
      return {
        status: "need_check",
        ok: null,
        returnTid: null,
        text: `ℹ️ ${label} যাচাই: একজনের নাম মিলেছে, বাবা ও মা উভয়ের নাম দুই NID-তেই মিলিয়ে নিন।`,
      };
    }

    return { status: "unknown", ok: null, returnTid: null, text: "" };
  }

  /* ------------------------------------------------------------ amounts & dates */
  function toAscii(s) { return String(s == null ? "" : s).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d)); }
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
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/, (m) => iso(+m[3], +m[2], +m[1])],
    [/\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(\d{4})\b/, (m) => (MON[m[2].toLowerCase()] ? iso(+m[3], MON[m[2].toLowerCase()], +m[1]) : null)],
    [/\b(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2})\b/, (m) => (MON[m[2].toLowerCase()] ? iso(2000 + (+m[3]), MON[m[2].toLowerCase()], +m[1]) : null)],
  ];
  function findDate(line) {
    const s = toAscii(line);
    for (const [re, fn] of DATE_RES) {
      const m = re.exec(s);
      if (m) {
        const d = fn(m);
        if (d) return { date: d, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*([AP]M)?/gi, " ") };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ provider & bKash/Nagad specifics */
  const PROVIDERS = [
    { id: "bkash", re: /bkash/i, verified: true, fullCheck: true },
    { id: "nagad", re: /nagad/i, verified: true, fullCheck: true },
    { id: "rocket", re: /rocket|dutch[\s-]*bangla/i, verified: false, fullCheck: false },
    { id: "bank", re: /\bbank\b|islami|brac|city\s*bank|eastern|prime|mutual\s*trust|sonali|janata|agrani|rupali|pubali|uttara|ific|ncc|one\s*bank|standard\s*chartered|hsbc|ab\s*bank|southeast|mercantile|jamuna|shahjalal|exim|social\s*islami|al[\s-]*arafah|first\s*security|premier\s*bank|dhaka\s*bank|midland|modhumoti|nrb|sbac|padma|shimanto|citizens|bengal\s*commercial|community\s*bank|global\s*islami|union\s*bank|meghna/i, verified: false, fullCheck: false },
  ];
  function detectProvider(lines) {
    const head = lines.slice(0, 40).join(" ");
    const tail = lines.slice(-20).join(" ");
    const combined = head + " " + tail;
    if (/nagad|নগদ|ডাক বিভাগের ডিজিটাল লেনদেন|nagad\.com\.bd/i.test(combined)
        || (/Statement Generation Date/i.test(head) && /Last KYC Status/i.test(head))) {
      return PROVIDERS.find((p) => p.id === "nagad");
    }
    return PROVIDERS.find((p) => p.re.test(combined)) || { id: "bank", verified: false, fullCheck: false };
  }

  const BKASH_FORBIDDEN = [
    { key: "palmpay", label: "PalmPay / Palm", tid: "adr.11", re: /\bpalm\s*pay\b|\bpalmpay\b/i },
    { key: "shohoz", label: "Shohoz / SahajMobile", tid: "adr.18", re: /\bshohoz\b|\bsahaj\s*mobile\b|\bsahaj\b/i },
    { key: "ambala", label: "Ambala", tid: "adr.22", re: /\bambala\b/i },
    { key: "momo", label: "Momo", tid: "adr.12", re: /\bmomo\b/i },
  ];
  function scanBkashKeywords(lines) {
    const hits = [];
    const full = lines.join("\n");
    for (const kw of BKASH_FORBIDDEN) {
      if (kw.re.test(full)) hits.push({ key: kw.key, label: kw.label, tid: kw.tid });
    }
    return hits;
  }

  function parseBkashStructured(structuredRows) {
    if (!Array.isArray(structuredRows) || !structuredRows.length) return null;
    const rows = [];
    let overviewOut = null, overviewIn = null;
    let colMinX = 330, outStart = 340, outEnd = 405, inEnd = 465, chgEnd = 515;

    for (let i = 0; i < structuredRows.length; i++) {
      const r = structuredRows[i];
      const txt = r.text || "";
      if (/Cash\s*Out/i.test(txt) && /Cash\s*In/i.test(txt) && /Balance/i.test(txt)) {
        const pOut = r.parts.find((p) => /Cash\s*Out/i.test(p.s));
        const pIn = r.parts.find((p) => /Cash\s*In/i.test(p.s));
        const pChg = r.parts.find((p) => /Charge/i.test(p.s));
        const pBal = r.parts.find((p) => /Balance/i.test(p.s));
        if (pOut && pIn && pBal) {
          outStart = Math.max(250, pOut.x - 18);
          colMinX = outStart - 10;
          outEnd = (pOut.x + pIn.x) / 2 + 6;
          inEnd = pChg ? (pIn.x + pChg.x) / 2 + 6 : (pIn.x + pBal.x) / 2;
          chgEnd = pChg ? (pChg.x + pBal.x) / 2 + 6 : pBal.x - 12;
        }
      }
      const mOut = /^Total Out:\s*([\d,]+\.\d{2})/i.exec(txt);
      if (mOut) overviewOut = parseAmount(mOut[1]);
      const mIn = /^Total In:\s*([\d,]+\.\d{2})/i.exec(txt);
      if (mIn) overviewIn = parseAmount(mIn[1]);

      const dtPart = r.parts.find((p) => p.x < 75 && /^\d{2}-[A-Za-z]{3}-\d{2,4}$/.test(p.s.trim()));
      if (!dtPart) continue;
      const f = findDate(dtPart.s.trim());
      if (!f) continue;

      let outAmt = 0, inAmt = 0, charge = 0, balance = null;
      for (const p of r.parts) {
        if (p.x < colMinX) continue;
        const val = parseAmount(p.s.trim());
        if (val === null) continue;
        if (p.x >= outStart && p.x < outEnd) outAmt = Math.abs(val);
        else if (p.x >= outEnd && p.x < inEnd) inAmt = Math.abs(val);
        else if (p.x >= inEnd && p.x < chgEnd) charge = val;
        else if (p.x >= chgEnd) balance = val;
      }
      if (outAmt === 0 && inAmt === 0) continue;
      rows.push({
        date: f.date,
        in: inAmt,
        out: outAmt,
        charge,
        balance,
        dir: inAmt > 0 ? "in" : "out",
      });
    }
    if (!rows.length) return null;
    return { rows, skipped: 0, overviewOut, overviewIn, isBkashLayout: true };
  }

  const IN_WORDS = /(cash\s*in|received|receive|deposit|add\s*money|credit|cr\b|salary|incoming|from\s|refund|cash-in|card\s*to\s*bkash|bank\s*to\s*bkash|remittance|cashback|reward\s*disbursement|ক্যাশ\s*ইন|জমা)/i;
  const OUT_WORDS = /(cash\s*out|send\s*money|payment|withdraw|debit|dr\b|transfer\s*to|recharge|top\s*up|bill|purchase|cash-out|ক্যাশ\s*আউট|উত্তোলন|পেমেন্ট)/i;
  const MONEY_RE = /-?\d[\d,]*\.\d{1,2}|-?\d{1,3}(?:,\d{3})+|-?\d+/g;

  function lineAmounts(rest) {
    return (rest.match(MONEY_RE) || []).map(parseAmount).filter((v) => v !== null);
  }
  function parseLine(line) {
    const f = findDate(line);
    if (!f) return null;
    const rest = f.rest
      .replace(/TRX\s*ID:\s*[A-Z0-9]+/gi, " ")
      .replace(/\b[A-Za-z0-9]{8,}\b/g, " ")
      .replace(/\b\d{7,}\b/g, " ")
      .replace(/\b(?:88)?0?1\d{9,10}\b/g, " ");
    const amounts = lineAmounts(rest);
    if (!amounts.length) return null;
    return { date: f.date, amounts, text: line };
  }

  function parseRows(lines, structuredRows) {
    const bk = parseBkashStructured(structuredRows);
    if (bk) return bk;

    const raw = lines.map(parseLine).filter(Boolean);
    const rows = [], skipped = [];
    let prevBal = null;
    for (const r of raw) {
      let amount, charge = 0, balance = null, dir = null;
      const a = r.amounts;
      if (a.length >= 3 && a[a.length - 2] < 0) {
        amount = Math.abs(a[a.length - 3]);
        charge = a[a.length - 2];
        balance = a[a.length - 1];
      } else if (a.length >= 2) {
        amount = Math.abs(a[a.length - 2]);
        balance = a[a.length - 1];
      } else {
        amount = Math.abs(a[0]);
      }
      if (balance !== null && prevBal !== null) {
        const dIn = Math.abs(prevBal + amount + charge - balance);
        const dOut = Math.abs(prevBal - amount + charge - balance);
        if (dIn < 0.015 && dOut >= 0.015) dir = "in";
        else if (dOut < 0.015 && dIn >= 0.015) dir = "out";
      }
      if (!dir) {
        const i = IN_WORDS.test(r.text), o = OUT_WORDS.test(r.text);
        if (i && !o) dir = "in";
        else if (o && !i) dir = "out";
      }
      if (balance !== null) prevBal = balance;
      if (!dir) { skipped.push(r.text); continue; }
      rows.push({ date: r.date, in: dir === "in" ? amount : 0, out: dir === "out" ? amount : 0, charge, balance, dir });
    }
    return { rows, skipped, overviewOut: null, overviewIn: null, isBkashLayout: false };
  }

  /* ------------------------------------------------------------ SOP money & period check */
  function addDays(isoDate, n) {
    const d = new Date(isoDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function monthKey(isoDate) { return isoDate.slice(0, 7); }
  function prevMonths(appIso, n) {
    let y = +appIso.slice(0, 4), m = +appIso.slice(5, 7);
    const out = [];
    for (let i = 0; i < n; i++) {
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
      out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    }
    return out;
  }

  function findStatementPeriod(lines) {
    const head = lines.slice(0, 35);
    for (let i = 0; i < head.length; i++) {
      const s = toAscii(head[i]) + (i + 1 < head.length ? " " + toAscii(head[i + 1]) : "");
      const m = /Statement\s*Period\s*[:\-]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[\s-][A-Za-z]{3}[\s-]\d{2,4})\s*(?:to|TO|-)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[\s-][A-Za-z]{3}[\s-]\d{2,4})/i.exec(s);
      if (m) {
        const d1 = findDate(m[1]), d2 = findDate(m[2]);
        if (d1 && d2) return { start: d1.date, end: d2.date };
      }
    }
    return null;
  }

  function sopCheck(rows, appIso, cfg, lines) {
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
    const total3 = list.reduce((s, p) => s + p.in + p.out, 0);
    const activeMonths = list.filter((p) => p.count > 0).length;

    const dates = rows.map((r) => r.date).sort();
    const period = findStatementPeriod(lines || []);
    const spanStart = period ? period.start : (dates[0] || null);
    const spanEnd = period ? period.end : (dates[dates.length - 1] || null);

    let covered = activeMonths;
    if (spanStart && spanEnd) {
      const sMon = spanStart.slice(0, 7), eMon = spanEnd.slice(0, 7);
      const spanned = months.filter((mk) => mk >= sMon && mk <= eMon).length;
      if (spanned > covered) covered = spanned;
    }

    return {
      months: list,
      best,
      total3,
      activeMonths,
      covered,
      passMin: best >= c.minMonth - c.tolerance,
      passFast: best >= c.fastTrack - c.tolerance,
      passHighMrp15k: total3 >= c.highMrpTx3 - c.tolerance,
      passHighMrpExempt30k: total3 >= c.tx3Exempt - c.tolerance,
      excluded: c.excludeLastDays,
      first: dates[0] || null,
      last: dates[dates.length - 1] || null,
      period,
      cutoff,
    };
  }

  /* ------------------------------------------------------------ authenticity & bKash/Nagad checks */
  function balanceCheck(rows) {
    const withBal = rows.filter((r) => r.balance !== null);
    if (withBal.length < 3) return { checked: 0, broken: 0 };
    const asc = withBal[0].date <= withBal[withBal.length - 1].date;
    const seq = asc ? withBal : withBal.slice().reverse();
    let checked = 0, broken = 0;
    for (let i = 1; i < seq.length; i++) {
      checked++;
      const chg = seq[i].charge || 0;
      const exp = seq[i - 1].balance + seq[i].in - seq[i].out + chg;
      if (Math.abs(exp - seq[i].balance) > 0.015) broken++;
    }
    return { checked, broken };
  }

  const EDITORS = /(photoshop|illustrator|canva|ilovepdf|smallpdf|sejda|pdfescape|pdf24|foxit phantom|acrobat|word|libreoffice|writer|wps|nitro|pdfelement|master pdf|pdf-xchange|pdfsam|pdfcandy|sodapdf|online|fake|gimp|inkscape|affinity)/i;
  const GENUINE_HINT = /(bkash|nagad|rocket|dutch|bangla|bank|jasper|itext|openpdf|crystal|ireport|birt|apache fop|wkhtml|reportlab|pdfkit|dompdf|tcpdf|mpdf|fpdf|chrome|skia|prince)/i;

  function pdfDate(s) {
    const m = /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(s || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))) : null;
  }

  function checkBkashFonts(meta) {
    const names = Array.isArray(meta && meta.fontNames) ? meta.fontNames : [];
    if (!names.length) return { checked: false, ok: true, warn: null };
    const clean = names
      .map((n) => String(n).replace(/^\//, "").trim())
      .filter((n) => n && !/^g_d\d+_f\d+$/i.test(n));
    if (!clean.length) return { checked: false, ok: true, warn: null };
    const hasRobotoReg = clean.some((n) => /^([A-Z]{6}\+)?Roboto-Regular$/i.test(n));
    const hasRobotoBold = clean.some((n) => /^([A-Z]{6}\+)?Roboto-Bold$/i.test(n));
    const foreign = clean.filter((n) => !/^(([A-Z]{6}\+)?Roboto-(Regular|Bold)|Helvetica)$/i.test(n));
    if (foreign.length > 0 || !hasRobotoReg || !hasRobotoBold) {
      return {
        checked: true,
        ok: false,
        warn: `⚠️ bKash ফন্ট অমিল (Edited/Fake সন্দেহ): পাওয়া গেছে [${clean.join(", ")}] — আসল bKash PDF-এ শুধুমাত্র Roboto-Regular (যেমন XYZQWE+Roboto-Regular), Roboto-Bold ও Helvetica থাকে।`,
      };
    }
    return { checked: true, ok: true, warn: null };
  }

  function signals(meta, rows, bal, provider, parsedInfo) {
    const isFull = provider && (provider.id === "bkash" || provider.id === "nagad");
    if (!isFull) {
      return [
        { level: "info", text: "ℹ️ Bank Statement: শুধুমাত্র লেনদেনের টাকা-পয়সা অটো যাচাই করা হয়েছে — নাম ও PDF authenticity ম্যানুয়ালি চেক করুন।" },
      ];
    }

    const out = [];
    const m = meta || {};
    const isBkash = provider.id === "bkash";
    const tool = `${m.producer || ""} ${m.creator || ""}`.trim();

    if (tool && EDITORS.test(tool) && !GENUINE_HINT.test(tool)) {
      out.push({ level: "warn", text: `PDF বানানো/বদলানো হয়েছে এই tool-এ: "${tool}" — সাধারণ editor/converter, statement system-এর generator নয়।` });
    } else if (isBkash && parsedInfo && parsedInfo.isBkashLayout) {
      const prodOk = /OpenPDF/i.test(m.producer || "") && /bKash/i.test(m.creator || "");
      if (!prodOk) {
        out.push({ level: "warn", text: `bKash PDF-এর Producer/Creator আসল সিস্টেমের সাথে মেলেনি ("${tool || "empty"}") — আসল bKash-এ "OpenPDF / bKash Limited" থাকে।` });
      } else {
        out.push({ level: "ok", text: `bKash অরিজিনাল Generator মিলেছে (${m.producer} / ${m.creator})।` });
      }
    } else if (tool) {
      out.push({ level: "info", text: `PDF generator: "${tool}"` });
    } else {
      out.push({ level: "info", text: "PDF-এ producer তথ্য নেই।" });
    }

    if (isBkash && parsedInfo && parsedInfo.isBkashLayout) {
      const fc = checkBkashFonts(m);
      if (fc.checked) {
        if (!fc.ok) out.push({ level: "warn", text: fc.warn });
        else out.push({ level: "ok", text: "bKash অরিজিনাল ফন্ট যাচাইকৃত (Roboto-Regular, Roboto-Bold, Helvetica)।" });
      }
      if (parsedInfo.overviewIn !== null && rows && rows.length) {
        const sumIn = rows.reduce((s, r) => s + r.in, 0);
        const sumOut = rows.reduce((s, r) => s + r.out, 0);
        const sumOutWithFee = rows.reduce((s, r) => s + r.out + Math.abs(r.charge || 0), 0);
        const outMatches = parsedInfo.overviewOut === null
          || Math.abs(sumOutWithFee - parsedInfo.overviewOut) <= 0.05
          || Math.abs(sumOut - parsedInfo.overviewOut) <= 0.05;
        if (Math.abs(sumIn - parsedInfo.overviewIn) > 0.05 || !outMatches) {
          out.push({ level: "warn", text: `Overview-এর Total In/Out-এর সাথে লেনদেনের যোগফল মেলেনি — সংখ্যায় edit হয়ে থাকতে পারে।` });
        } else {
          out.push({ level: "ok", text: "Overview Total In / Total Out এবং সব লেনদেনের যোগফল হুবহু মিলেছে।" });
        }
      }
    }

    const c = pdfDate(m.creationDate), d = pdfDate(m.modDate);
    if (c && d && Math.abs(d - c) > 120000) {
      out.push({ level: "warn", text: "PDF তৈরির পর পরে আবার বদলানো (modified) হয়েছে — metadata-র তারিখ আলাদা।" });
    }
    if (m.revisions > 1) {
      out.push({ level: "warn", text: `PDF-এ ${m.revisions}টি save-revision আছে — তৈরির পর edit হয়ে থাকতে পারে।` });
    }
    if (bal && bal.checked >= 3) {
      if (bal.broken > 0) {
        out.push({ level: "warn", text: `Balance হিসাব মেলেনি ${bal.broken}/${bal.checked} জায়গায় (আগের balance ± amount + fee ≠ নতুন balance)। Edit হয়ে থাকতে পারে।` });
      } else {
        out.push({ level: "ok", text: `Balance হিসাব ${bal.checked}টি row-তে ঠিকঠাক মিলেছে।` });
      }
    } else if (rows && rows.length) {
      out.push({ level: "info", text: "Running balance ৩টির কম হওয়ায় ধারাবাহিক balance যাচাই করা যায়নি।" });
    }
    if (m.textChars !== undefined && m.textChars < 40) {
      out.push({ level: "warn", text: "PDF-এ প্রায় কোনো লেখা নেই — scan/ছবি হতে পারে।" });
    }
    return out;
  }

  /* ------------------------------------------------------------ holder name & relation check */
  const NAME_LABEL = /(account\s*name|customer\s*name|name\s*of\s*account|account\s*holder|holder\s*name|name|নাম)\s*[:\-]\s*(.*)$/i;
  function findHolderName(lines) {
    const top = lines.slice(0, 30);
    for (let i = 0; i < top.length; i++) {
      const l = toAscii(top[i]).trim();
      const m = NAME_LABEL.exec(l);
      if (m) {
        let n = m[2].replace(/\s{2,}.*/, "").trim();
        if (!n && i + 1 < top.length) {
          n = toAscii(top[i + 1]).replace(/\s{2,}.*/, "").trim();
        }
        if (n && n.length >= 3 && !/^(Statement|Account|Customer|Active|Status|Date|Period)/i.test(n)) return n;
      }
      if (/^bKash Statement$/i.test(l)) {
        for (let j = i + 1; j <= Math.min(i + 4, top.length - 1); j++) {
          const cand = toAscii(top[j]).trim();
          if (!cand || /^(User Type|Statement Period|bKash Account|Issue Date|Overview|16247|www\.)/i.test(cand)) continue;
          if (/^[A-Za-z.\s]{3,60}$/.test(cand)) return cand;
        }
      }
      if (/^Statement Generation Date\b/i.test(l) || /^Statement of Account\b/i.test(l)) {
        for (let j = Math.max(0, i - 2); j <= Math.min(i + 2, top.length - 1); j++) {
          const cand = toAscii(top[j]).split(/\s{2,}/)[0].trim();
          if (!cand || /^(Statement|Account|Registration|Last KYC|DHAKA|BANANI|GULSHAN|MIRPUR|UTTARA|ROAD|HOUSE|AVENUE|DELTA|Page|Sl\.)/i.test(cand)) continue;
          if (/^[A-Za-z][A-Za-z.\s]{2,55}$/.test(cand) && cand.split(/\s+/).length >= 2) return cand;
        }
      }
    }
    for (const l of lines.slice(-10)) {
      const mBk = /bKash Statement\s*-\s*([A-Za-z.\s]{3,60})$/i.exec(toAscii(l).trim());
      if (mBk) return mBk[1].trim();
    }
    return null;
  }

  function evaluateHolder(holder, customerName, guarantorName, guarantorRelation, provider, relationCheck) {
    const isFull = !provider || provider.id === "bkash" || provider.id === "nagad";
    if (!isFull) {
      return {
        status: "manual_bank",
        match: null,
        returnTid: null,
        text: holder
          ? `ℹ️ Bank Statement (নাম: "${holder}"): নাম ও authenticity ম্যানুয়ালি যাচাই করতে হবে।`
          : "ℹ️ Bank Statement: নাম ও authenticity ম্যানুয়ালি যাচাই করতে হবে।",
      };
    }

    if (!holder) return { status: "unknown", text: "Statement থেকে account-holder-এর নাম পাওয়া যায়নি।" };
    const custMatch = customerName ? strictNameMatch(customerName, holder) : null;
    if (custMatch && custMatch.ok) {
      const extra = custMatch.note ? ` (${custMatch.note})` : "";
      return { status: "ok_customer", match: custMatch, returnTid: null, text: `✅ Customer-এর নামের সাথে নাম মিলেছে — "${holder}"${extra}` };
    }
    const guarMatch = guarantorName ? strictNameMatch(guarantorName, holder) : null;
    if (guarMatch && guarMatch.ok) {
      const extra = guarMatch.note ? ` (${guarMatch.note})` : "";
      if (ALLOWED_GUARANTOR_RELATIONS.has(guarantorRelation)) {
        if (relationCheck && relationCheck.ok === false && relationCheck.returnTid) {
          return {
            status: "return_relation_mismatch",
            match: guarMatch,
            returnTid: relationCheck.returnTid,
            text: `❌ RETURN (${relationCheck.returnTid}): Statement Guarantor-এর নামে ("${holder}")${extra}, কিন্তু সম্পর্ক যাচাইয়ে সমস্যা — ${relationCheck.text}`,
          };
        }
        const relLabel = guarantorRelation === "spouse" ? "Wife / Spouse" : `${guarantorRelation} — First Blood`;
        return {
          status: "ok_guarantor_fb",
          match: guarMatch,
          returnTid: null,
          text: `✅ Guarantor (${relLabel})-এর নামের সাথে নাম মিলেছে — "${holder}"${extra}`,
        };
      }
      return {
        status: "return_non_fb",
        match: guarMatch,
        returnTid: "stm.28",
        text: `❌ RETURN (stm.28): Statement-টি Guarantor-এর নামে ("${holder}"), কিন্তু রক্তের সম্পর্ক (বাবা/মা/ছেলে/মেয়ে/ভাই/বোন) বা Wife নয় — গ্রহণযোগ্য নয়।`,
      };
    }
    if (customerName || guarantorName) {
      const whyCust = custMatch && custMatch.problem ? `Customer তুলনা: ${custMatch.problem}` : "";
      const whyGuar = guarMatch && guarMatch.problem ? `Guarantor তুলনা: ${guarMatch.problem}` : "";
      const detail = [whyCust, whyGuar].filter(Boolean).join(" | ");
      return {
        status: "return_other",
        match: custMatch,
        returnTid: "stm.28",
        text: `❌ RETURN (stm.28): Statement-এর নাম ("${holder}") মেলেনি — ${detail}`,
      };
    }
    return { status: "no_input", text: `Statement-এ নাম: "${holder}" (Customer/Guarantor নাম দিলে মিলিয়ে দেখা হবে)।` };
  }

  /* ------------------------------------------------------------ whole analysis */
  function analyze(input) {
    const lines = input.lines || [];
    const provider = detectProvider(lines);
    const isFull = provider.id === "bkash" || provider.id === "nagad";
    const parsed = parseRows(lines, input.structuredRows);
    const sop = sopCheck(parsed.rows, input.appDate, input.cfg, lines);
    const bal = isFull ? balanceCheck(parsed.rows) : { checked: 0, broken: 0 };
    const holder = findHolderName(lines);
    const custPreliminary = isFull && input.customerName && holder ? strictNameMatch(input.customerName, holder) : null;
    const stmtNameMismatch = Boolean(isFull && holder && input.customerName && !(custPreliminary && custPreliminary.ok));
    const relationCheck = input.guarantorRelation
      ? verifyGuarantorRelation({
          relation: input.guarantorRelation,
          statementNameMismatch: stmtNameMismatch,
          customerName: input.customerName,
          customerFather: input.customerFather,
          customerMother: input.customerMother,
          customerHusband: input.customerHusband,
          guarantorName: input.guarantorName,
          guarantorFather: input.guarantorFather,
          guarantorMother: input.guarantorMother,
          guarantorHusband: input.guarantorHusband,
          spouseProof: input.spouseProof,
        })
      : null;
    const holderCheck = evaluateHolder(holder, input.customerName, input.guarantorName, input.guarantorRelation, provider, relationCheck);
    const forbiddenHits = isFull ? scanBkashKeywords(lines) : [];

    return {
      provider,
      isFullCheck: isFull,
      holder,
      name: isFull && input.customerName && holder ? strictNameMatch(input.customerName, holder) : null,
      holderCheck,
      relationCheck,
      forbiddenHits,
      rows: parsed.rows.length,
      skipped: parsed.skipped,
      sop,
      balance: bal,
      signals: signals(input.meta, parsed.rows, bal, provider, parsed),
    };
  }

  return {
    CONFIG,
    FIRST_BLOOD,
    ALLOWED_GUARANTOR_RELATIONS,
    nameMatch,
    strictNameMatch,
    relationNameMatch,
    verifyGuarantorRelation,
    parseAmount,
    findDate,
    parseLine,
    parseRows,
    sopCheck,
    balanceCheck,
    signals,
    findHolderName,
    evaluateHolder,
    scanBkashKeywords,
    detectProvider,
    analyze,
    prevMonths,
    addDays,
  };
});
