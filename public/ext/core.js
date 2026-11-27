/* core.js - PURE helpers for the TopPay extension (no DOM, no network). Used by content.js and by the node tests.
   Nothing here stores or sends customer data; it only turns scraped text into numbers/flags. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TPCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const toAscii = (s) => String(s == null ? "" : s).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));
  const digitsOf = (s) => toAscii(s).replace(/\D/g, "");

  /* ---------------- phones ---------------- */
  function normalizePhone(p) {
    const d = digitsOf(p);
    if (d.startsWith("8801") && d.length === 13) return d.slice(2);
    if (d.startsWith("1") && d.length === 10) return "0" + d;
    return d;
  }
  const isEmptyVal = (v) => v === undefined || v === null || /^\s*(empty|n\/a|-|—)?\s*$/i.test(String(v));

  /* entries: [{key, label, val}]  keys: osr, customer, guarantor, family, colleague
     professionKey: optional canonical key ("house_owner", "job_holder", etc.)
     - house_owner (Land Owner): Family phone required, Colleague phone NOT required.
     - Other known professions: Colleague phone required, Family phone NOT required.
     - Unknown profession (null/undefined): checks both so nothing is missed. */
  function phoneChecks(entries, professionKey) {
    const out = [];
    const seen = {};
    const isLandOwner = professionKey === "house_owner";
    const profKnown = Boolean(professionKey);

    entries.forEach((e) => {
      if (isEmptyVal(e.val)) {
        if (e.key === "family" && (!profKnown || isLandOwner)) {
          out.push({ key: "phone:family-empty", kind: "return", tid: "qi.27", title: "Family phone is empty" });
        } else if (e.key === "colleague" && (!profKnown || !isLandOwner)) {
          out.push({ key: "phone:colleague-empty", kind: "return", tid: "adr.15", title: "Colleague name/number is empty" });
        } else if (e.key === "guarantor") {
          out.push({ key: "phone:guarantor-empty", kind: "return", tid: "con.10", title: "Guarantor phone is empty" });
        }
        return;
      }
      const n = normalizePhone(e.val);
      if (n.length !== 11 || !/^01[3-9]\d{8}$/.test(n)) {
        out.push({ key: "phone:format:" + e.key, kind: "note", title: `${e.label} phone "${e.val}" does not look like a valid BD mobile number` });
      }
      if (seen[n]) {
        out.push({
          key: `phone:dup:${seen[n].key}:${e.key}`,
          kind: "return",
          tid: (e.key === "colleague" || seen[n].key === "colleague") ? "adr.14" : "qi.26",
          title: `Same number (${n}) used for ${seen[n].label} and ${e.label}`
        });
      } else seen[n] = e;
    });
    return out;
  }


  /* ---------------- IMEI Check ---------------- */
  function luhnCheck(num) {
    const d = digitsOf(num);
    if (!/^\d{15}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      let n = Number(d[14 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function lookupImeiBrand(imei) {
    const d = digitsOf(imei);
    if (d.length < 8) return null;
    const tac = d.slice(0, 8);
    const rbi = d.slice(0, 2);
    const RBI_MAP = {
      "86": "China TAF (OPPO, Realme, Vivo, Xiaomi, Tecno, Infinix, Itel, Symphony)",
      "35": "BABT UK (Samsung, Apple, Nokia, Motorola, Pixel)",
      "01": "CTIA US (Apple, Motorola, Google)",
      "99": "Global / Dual-Mode (GCF)",
      "91": "MSAI India (Samsung, Xiaomi, Realme, Vivo)",
      "49": "BABT Germany (Nokia, Siemens, Sony)",
      "52": "CETECOM (Samsung, LG)",
      "53": "CETECOM (Huawei, Honor, ZTE)",
    };
    const rbiLabel = RBI_MAP[rbi] || `Reporting Body ${rbi}`;
    return { tac, rbi, rbiLabel, brandHint: rbiLabel };
  }

  function checkImei(systemImei, boxImei) {
    const sys = digitsOf(systemImei);
    const box = digitsOf(boxImei);
    if (!sys) {
      return {
        sys: "", box, present: false, lengthOk: false, luhnOk: false,
        tacInfo: null, boxMatch: null, returnTid: null, status: "empty",
        summary: "⚠️ System IMEI পাওয়া যায়নি",
      };
    }
    const lengthOk = sys.length === 15;
    const valid = lengthOk && luhnCheck(sys);
    const tacInfo = sys.length >= 8 ? lookupImeiBrand(sys) : null;
    let boxMatch = null;
    let returnTid = null;

    if (box.length > 0) {
      if (lengthOk && box.length === 15 && sys === box) {
        boxMatch = true;
      } else if (box.length === 15 || !lengthOk) {
        boxMatch = false;
        returnTid = "adr.10";
      }
    }

    let status = "valid_format";
    let summary = "✅ 15-digit IMEI ও Checksum ঠিক আছে";
    if (!lengthOk) {
      status = "invalid_len";
      summary = `❌ IMEI ${sys.length} ডিজিটের (১৫ ডিজিট হতে হবে)`;
    } else if (!valid) {
      status = "bad_checksum";
      summary = "❌ IMEI Checksum (Luhn) মেলেনি — নম্বরটি ভুল হতে পারে";
    } else if (boxMatch === false) {
      status = "box_mismatch";
      summary = `❌ বক্সের IMEI (${box}) ও সিস্টেমের IMEI (${sys}) মেলেনি (adr.10)`;
    } else if (boxMatch === true) {
      status = "verified_match";
      summary = "✅ System IMEI, Checksum এবং Box IMEI হুবহু মিলেছে";
    }

    return { sys, box, present: true, lengthOk, luhnOk: valid, tacInfo, boxMatch, returnTid, status, summary };
  }

  function repairOcrDigits(s) {
    return String(s || "")
      .replace(/[OoQD]/g, "0")
      .replace(/[Iil|!]/g, "1")
      .replace(/[Zz]/g, "2")
      .replace(/[Ss]/g, "5")
      .replace(/[Gg]/g, "6")
      .replace(/[Bb]/g, "8");
  }

  function parseImeiTexts(texts) {
    const valid = [];
    const raw15 = [];
    const pushCand = (d) => {
      if (d.length !== 15) return;
      if (luhnCheck(d)) {
        if (!valid.includes(d)) valid.push(d);
      } else if (!raw15.includes(d)) {
        raw15.push(d);
      }
    };

    (texts || []).forEach((raw) => {
      const t = toAscii(raw).replace(/\r/g, "\n");
      t.split("\n").forEach((line) => {
        if (/(?:I\s*M\s*E\s*I|M\s*E\s*I\s*D)/i.test(line)) {
          const after = line.replace(/^.*?(?:I\s*M\s*E\s*I\s*[12]?|M\s*E\s*I\s*D)\s*[:\-#.]?\s*/i, "");
          const fixed = repairOcrDigits(after);
          (fixed.match(/\d(?:[\s-]?\d){14}/g) || []).forEach((c) => pushCand(c.replace(/\D/g, "")));
        }
      });
      const labeled = t.matchAll(/(?:IMEI\s*[12]?|I\.M\.E\.I)[^0-9]{0,12}(\d(?:[\s-]?\d){13,16})/gi);
      for (const m of labeled) {
        pushCand(m[1].replace(/\D/g, ""));
      }
      const all = t.match(/\d(?:[\s-]?\d){14}/g) || [];
      for (const c of all) {
        pushCand(c.replace(/\D/g, ""));
      }
    });
    return valid.length ? valid : raw15;
  }

  /* ---------------- NID ---------------- */
  /* NID number: equal, or the 13-digit old number is the tail of a 17-digit number (year prefix). */
  function nidNumbersMatch(a, b) {
    const x = digitsOf(a), y = digitsOf(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    return s.length === 13 && l.length === 17 && l.endsWith(s);
  }
  const MONTHS = {
    JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    DEE: 12, OEC: 12, DEG: 12, J4N: 1, M4Y: 5, J0N: 6, J0L: 7, "8PR": 4, "4PR": 4
  };
  const fixMonth = (m) => m.toUpperCase().replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/4/g, "A").replace(/8/g, "B").slice(0, 3);
  const fixDay = (d) => +String(d).toUpperCase().replace(/[OI]/g, "0").replace(/[L|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/\D/g, "");
  const pad = (n) => String(n).padStart(2, "0");

  /* texts: OCR output of several passes/sides -> {numbers:[digit strings 10/13/17], dob:{iso,count}|null} */
  function parseNidTexts(texts) {
    const numbers = [];
    const dobs = {};
    let mrzNid = "";
    let mrzDob = "";
    const cur = new Date().getUTCFullYear();

    (texts || []).forEach((raw) => {
      const t = toAscii(raw).replace(/\r/g, "\n");
      // numbers (spaces/dashes allowed inside)
      (t.match(/\d(?:[\s-]?\d){9,16}/g) || []).forEach((c) => {
        const d = c.replace(/\D/g, "");
        [17, 13, 10].forEach((L) => { if (d.length === L && !numbers.includes(d)) numbers.push(d); });
      });
      // line-by-line digit runs too (OCR often puts spaces: "598 986 2650" or "ID NO: 4214267173")
      t.split("\n").forEach((line) => {
        let cleanLine = line;
        if (/(?:ID\s*N[O0]|NID)/i.test(line)) {
          const afterLabel = line.replace(/^.*?(?:ID\s*N[O0]|NID)[^A-Z0-9]*/i, "");
          cleanLine = afterLabel.replace(/[Oo]/g, "0").replace(/[Iil|]/g, "1").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8");
        }
        const d = cleanLine.replace(/\D/g, "");
        if ([10, 13, 17].includes(d.length) && !numbers.includes(d)) numbers.push(d);
      });
      const icaoCheck = (str) => {
        const w = [7, 3, 1];
        let sum = 0;
        for (let i = 0; i < str.length; i++) {
          const ch = str[i];
          let v = 0;
          if (ch >= "0" && ch <= "9") v = ch.charCodeAt(0) - 48;
          else if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 55;
          sum += v * w[i % 3];
        }
        return sum % 10;
      };
      const cleanMrzDigits = (s) => s.replace(/[Oo]/g, "0").replace(/[Iil|]/g, "1").replace(/[Zz]/g, "2").replace(/[Ss]/g, "5").replace(/[Bb]/g, "8");

      // Smart NID MRZ line 1: I<BGD238403637<86 (tolerates '<' misread as K/C/L/(/space and 'I' as 1/l/|)
      const up = t.toUpperCase().replace(/\bO(\d)\b/g, "0$1");
      const mrzId = up.match(/[I1L|!][<KCL(«‹\s]{1,2}BGD\s*([0-9OILZSB]{9})[<KCL(«‹\s]{1,2}([0-9OILZSB])([0-9OILZSB])?/);
      if (mrzId) {
        let d = cleanMrzDigits(mrzId[1] + mrzId[2]);
        const chkRaw = mrzId[3] ? cleanMrzDigits(mrzId[3]) : "";
        const chk = /^\d$/.test(chkRaw) ? +chkRaw : NaN;
        if (/^\d{10}$/.test(d)) {
          let verifiedId = !Number.isNaN(chk) && icaoCheck(d) === chk;
          if (!verifiedId && !Number.isNaN(chk)) {
            const alts = { "3": ["9", "8"], "9": ["3", "5", "4"], "6": ["8", "5", "0"], "8": ["6", "3", "0"], "5": ["6", "9"], "0": ["8", "6"], "1": ["7"], "7": ["1", "2"], "2": ["7"], "4": ["9"] };
            outerId: for (let pos = 0; pos < 10; pos++) {
              for (const rep of (alts[d[pos]] || [])) {
                const trial = d.slice(0, pos) + rep + d.slice(pos + 1);
                if (icaoCheck(trial) === chk) {
                  d = trial;
                  verifiedId = true;
                  break outerId;
                }
              }
            }
          }
          mrzNid = d;
          const idx = numbers.indexOf(d);
          if (idx > 0) numbers.splice(idx, 1);
          if (idx !== 0) numbers.unshift(d);
        }
      }

      const re = /([\dOIL|]{1,2})[\s.,/-]*([A-Z01458]{3})[A-Z]*[\s.,/-]*((?:19|20)\d{2})/g;
      let m;
      while ((m = re.exec(up))) {
        const raw3 = m[2].toUpperCase().slice(0, 3);
        const mon = MONTHS[raw3] || MONTHS[fixMonth(raw3)];
        const day = fixDay(m[1]), yr = +m[3];
        if (!mon || day < 1 || day > 31) continue;
        const dt = new Date(Date.UTC(yr, mon - 1, day));
        if (dt.getUTCMonth() !== mon - 1) continue;
        const iso = `${yr}-${pad(mon)}-${pad(day)}`;
        dobs[iso] = (dobs[iso] || 0) + 1;
      }
      const r2 = /(?:BIRTH|DOB)[^0-9]{0,14}(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})/g;
      while ((m = r2.exec(up))) {
        const iso = `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
        dobs[iso] = (dobs[iso] || 0) + 2;
      }
      // Smart NID MRZ line 2 with ICAO 9303 check digit verification & OCR digit repair (e.g. 5405103M -> 9405103M)
      const mrzLine2 = up.match(/\b([0-9OILZSB]{6})([0-9OILZSB])[MF]([0-9OILZSB]{6})[0-9OILZSB]BGD/);
      if (mrzLine2) {
        let yymmdd = cleanMrzDigits(mrzLine2[1]);
        const chk = +cleanMrzDigits(mrzLine2[2]);
        const validYymmdd = (s) => {
          if (!/^\d{6}$/.test(s)) return false;
          const mm = +s.slice(2, 4), dd = +s.slice(4, 6);
          return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
        };
        let verified = validYymmdd(yymmdd) && icaoCheck(yymmdd) === chk;
        if (!verified && /^\d{6}$/.test(yymmdd) && !Number.isNaN(chk)) {
          const alts = { "5": ["9", "6"], "9": ["5", "4"], "8": ["0", "3"], "0": ["8"], "6": ["5", "0"], "1": ["7"], "7": ["1", "2"], "2": ["7"], "3": ["8"], "4": ["9"] };
          outer: for (let pos = 0; pos < 6; pos++) {
            const cands = alts[yymmdd[pos]] || [];
            for (const rep of cands) {
              const trial = yymmdd.slice(0, pos) + rep + yymmdd.slice(pos + 1);
              if (validYymmdd(trial) && icaoCheck(trial) === chk) {
                yymmdd = trial;
                verified = true;
                break outer;
              }
            }
          }
        }
        if (validYymmdd(yymmdd)) {
          const yy = +yymmdd.slice(0, 2);
          const fullYr = yy > (cur % 100) ? 1900 + yy : 2000 + yy;
          const iso = `${fullYr}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
          if (verified) mrzDob = iso;
          dobs[iso] = (dobs[iso] || 0) + (verified ? 4 : 1);
        }
      }
    });

    const best = Object.entries(dobs)
      .filter(([iso]) => +iso.slice(0, 4) >= 1930 && +iso.slice(0, 4) <= cur - 12)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { numbers, dob: best.length ? { iso: best[0][0], count: best[0][1] } : null, mrzNid, mrzDob };
  }

  /* ---------------- NID Back QR / PDF417 Parser ---------------- */
  function parseNidQrPayload(qrItems) {
    const items = Array.isArray(qrItems) ? qrItems : (qrItems ? [qrItems] : []);
    const rawList = items.map((x) => (typeof x === "string" ? x : (x && x.rawValue) || "")).filter(Boolean);
    const formats = items.map((x) => (typeof x === "object" && x && x.format) || "qr_code");
    if (!rawList.length) return { found: false, format: "", raw: "", nid: "", dob: "", name: "", father: "", mother: "" };

    let nid = "";
    let dob = "";
    let name = "";
    let father = "";
    let mother = "";
    const cur = new Date().getUTCFullYear();

    const tryPickNid = (val) => {
      if (nid) return;
      const d = digitsOf(val);
      if ([10, 13, 17].includes(d.length)) nid = d;
    };

    const tryPickDob = (val) => {
      if (dob) return;
      const s = toAscii(val).trim();
      const isoM = s.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
      if (isoM && +isoM[1] >= 1930 && +isoM[1] <= cur - 12) {
        dob = `${isoM[1]}-${pad(+isoM[2])}-${pad(+isoM[3])}`;
        return;
      }
      const dmyM = s.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/);
      if (dmyM && +dmyM[3] >= 1930 && +dmyM[3] <= cur - 12) {
        dob = `${dmyM[3]}-${pad(+dmyM[2])}-${pad(+dmyM[1])}`;
        return;
      }
      const monM = s.toUpperCase().match(/(\d{1,2})[\s.,/-]*([A-Z]{3})[A-Z]*[\s.,/-]*((?:19|20)\d{2})/);
      if (monM) {
        const mon = MONTHS[monM[2]] || MONTHS[fixMonth(monM[2])];
        const day = +monM[1], yr = +monM[3];
        if (mon && day >= 1 && day <= 31 && yr >= 1930 && yr <= cur - 12) {
          dob = `${yr}-${pad(mon)}-${pad(day)}`;
        }
      }
    };

    for (const raw of rawList) {
      const txt = toAscii(raw).trim();

      // 1. XML tags from Smart NID PDF417: <pin>...</pin>, <nid>...</nid>, <name>...</name>, <DOB>...</DOB>
      const xmlPin = txt.match(/<(?:pin|nid|id)>\s*([0-9\s-]+)\s*<\/(?:pin|nid|id)>/i);
      if (xmlPin) tryPickNid(xmlPin[1]);
      const xmlDob = txt.match(/<(?:dob|date_of_birth|birth)>\s*([^<]+)\s*<\/(?:dob|date_of_birth|birth)>/i);
      if (xmlDob) tryPickDob(xmlDob[1]);
      const xmlName = txt.match(/<name>\s*([^<]+)\s*<\/name>/i);
      if (xmlName && !name) name = xmlName[1].trim();
      const xmlFather = txt.match(/<(?:father|fname|father_name)>\s*([^<]+)\s*<\/(?:father|fname|father_name)>/i);
      if (xmlFather && !father) father = xmlFather[1].trim();
      const xmlMother = txt.match(/<(?:mother|mname|mother_name)>\s*([^<]+)\s*<\/(?:mother|mname|mother_name)>/i);
      if (xmlMother && !mother) mother = xmlMother[1].trim();

      // 2. Key-value lines / URL params (NW:, NID:, PIN:, NM:, FN:, MN:, DB:, DOB:)
      const kvNid = txt.match(/(?:^|[\n\r;,&?])\s*(?:nw|nid|pin|id_no|nid_no|national_id)\s*[:=]\s*([0-9\s-]{10,20})/i);
      if (kvNid) tryPickNid(kvNid[1]);
      const kvDob = txt.match(/(?:^|[\n\r;,&?])\s*(?:db|dob|birth|date_of_birth)\s*[:=]\s*([^\n\r;&]+)/i);
      if (kvDob) tryPickDob(kvDob[1]);
      const kvName = txt.match(/(?:^|[\n\r;,&?])\s*(?:nm|name|full_name)\s*[:=]\s*([^\n\r;&]+)/i);
      if (kvName && !name) {
        try { name = decodeURIComponent(kvName[1].replace(/\+/g, " ")).trim(); } catch { name = kvName[1].trim(); }
      }
      const kvFather = txt.match(/(?:^|[\n\r;,&?])\s*(?:fn|father|father_name)\s*[:=]\s*([^\n\r;&]+)/i);
      if (kvFather && !father) {
        try { father = decodeURIComponent(kvFather[1].replace(/\+/g, " ")).trim(); } catch { father = kvFather[1].trim(); }
      }
      const kvMother = txt.match(/(?:^|[\n\r;,&?])\s*(?:mn|mother|mother_name)\s*[:=]\s*([^\n\r;&]+)/i);
      if (kvMother && !mother) {
        try { mother = decodeURIComponent(kvMother[1].replace(/\+/g, " ")).trim(); } catch { mother = kvMother[1].trim(); }
      }

      // 3. Fallback: scan any 10/13/17-digit number and date in the QR payload
      if (!nid) {
        const nums = txt.match(/\b\d{10}(?:\d{3}(?:\d{4})?)?\b/g) || [];
        for (const cand of nums) {
          if ([10, 13, 17].includes(cand.length)) { nid = cand; break; }
        }
      }
      if (!dob) tryPickDob(txt);
    }

    return {
      found: true,
      format: formats[0] || "qr_code",
      raw: rawList[0],
      nid,
      dob,
      name,
      father,
      mother,
    };
  }


  /* ---------------- NID Fake / Tamper Cross-Validator ---------------- */
  function validateNidAuthenticity({ systemNid, frontNid, frontDob, backNid, backDob, qrData, forensics, otherPartyNid }) {
    const issues = [];
    const sNid = digitsOf(systemNid);
    const fNid = digitsOf(frontNid);
    const bNid = digitsOf(backNid || (qrData && qrData.nid));
    const oNid = digitsOf(otherPartyNid);
    const effectiveNid = fNid || bNid || sNid;
    const effectiveDob = frontDob || backDob || (qrData && qrData.dob) || "";

    // 1. Dummy or sequential NID number check (e.g. 1111111111 or 1234567890)
    if (effectiveNid && (/^(\d)\1+$/.test(effectiveNid) || "012345678901234567".includes(effectiveNid))) {
      issues.push({ code: "DUMMY_NID_PATTERN", severity: "high", msg: `সন্দেহজনক ডামি NID নম্বর (${effectiveNid})` });
    }

    const isOcrConfusableNearMatch = (a, b) => {
      if (!a || !b || a.length !== b.length) return false;
      const conf = { "3": "98", "9": "354", "6": "850", "8": "630", "5": "69", "0": "86", "1": "7", "7": "12", "2": "7", "4": "9" };
      let diffs = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          if (!(conf[a[i]] && conf[a[i]].includes(b[i]))) return false;
          diffs++;
        }
      }
      return diffs > 0 && diffs <= 2;
    };

    // 2. Front vs Back NID number mismatch (ignore 1-2 digit hologram OCR blur if back matches system NID)
    const frontIsOcrBlurOfBack = fNid && bNid && sNid && nidNumbersMatch(bNid, sNid) && isOcrConfusableNearMatch(fNid, bNid);
    if (fNid && bNid && !nidNumbersMatch(fNid, bNid) && !frontIsOcrBlurOfBack) {
      issues.push({ code: "FRONT_BACK_NID_MISMATCH", severity: "high", msg: `NID ফ্রন্ট (${fNid}) ও ব্যাক (${bNid}) নম্বর মিলছে না` });
    }

    // 3. Front vs Back DOB mismatch (catches edited front DOB when back QR/MRZ was not altered)
    if (frontDob && backDob && frontDob !== backDob) {
      issues.push({ code: "FRONT_BACK_DOB_MISMATCH", severity: "high", msg: `ফ্রন্ট DOB (${frontDob}) ও ব্যাক DOB (${backDob}) ভিন্ন` });
    }

    // 4. 17-digit NID birth year prefix (YYYY) must match document DOB year
    if (effectiveNid.length === 17 && effectiveDob.length >= 4) {
      const nidBirthYear = effectiveNid.slice(0, 4);
      const docBirthYear = effectiveDob.slice(0, 4);
      if (nidBirthYear !== docBirthYear) {
        issues.push({
          code: "NID17_BIRTH_YEAR_MISMATCH",
          severity: "high",
          msg: `১৭-ডিজিট NID-এর জন্মসাল (${nidBirthYear}) ও জন্মতারিখের সাল (${docBirthYear}) মেলেনি`
        });
      }
    }

    // 5. System portal NID vs Card NID mismatch
    if (sNid && effectiveNid && !nidNumbersMatch(sNid, effectiveNid)) {
      issues.push({ code: "SYSTEM_CARD_NID_MISMATCH", severity: "high", msg: "পোর্টালের NID নম্বরের সাথে কার্ডের নম্বর মেলেনি" });
    }

    // 6. Customer & Guarantor using the exact same NID
    if (effectiveNid && oNid && nidNumbersMatch(effectiveNid, oNid)) {
      issues.push({ code: "CUST_GUAR_SAME_NID", severity: "high", msg: "Customer ও Guarantor-এর NID নম্বর একই!" });
    }

    // 7. Image digital edit / screenshot forensics
    if (forensics && forensics.suspicious) {
      issues.push({
        code: "IMAGE_TAMPER_SUSPECT",
        severity: "medium",
        msg: `ছবিটি এডিটেড বা স্ক্রিনশট হতে পারে (${forensics.flags.join(", ")})`
      });
    }

    return {
      isAuthenticLikely: issues.filter((x) => x.severity === "high").length === 0,
      tamperDetected: issues.some((x) => x.severity === "high"),
      issues
    };
  }

  /* decimal years like the web app: months/12, 2 decimals, Dhaka date */
  function dhakaToday(now) {
    const d = new Date((now || new Date()).getTime() + 6 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  function ageFromIso(iso, now) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    const t = dhakaToday(now);
    let months = (t.y - +m[1]) * 12 + (t.m - +m[2]);
    if (t.d < +m[3]) months -= 1;
    if (months < 0) return null;
    return { years: Math.floor(months / 12), months: months % 12, decimal: Math.round((months / 12) * 100) / 100 };
  }

  /* ---------------- portal text -> engine values ---------------- */
  function mapProfession(txt) {
    const raw = String(txt == null ? "" : txt).trim();
    if (!raw) return null;
    const numMap = {
      "1": "job_holder",
      "2": "businessman",
      "3": "student",
      "4": "house_owner",
      "5": "rider",
      "6": "unemployed",
      "7": "other",
    };
    if (numMap[raw]) return numMap[raw];
    const t = raw.toLowerCase();
    if (/journalist|media|press|সাংবাদিক/.test(t)) return "media_press";
    if (/police|army|military|defen[cs]e|navy|air ?force|bgb|র‍্যাব|পুলিশ|সেনা/.test(t)) return "defense";
    if (/lawyer|advocate|আইনজীবী/.test(t)) return "lawyer";
    if (/\bngo\b/.test(t)) return "ngo_loan";
    if (/student|ছাত্র|ছাত্রী/.test(t)) return "student";
    if (/rider|delivery|পাঠাও|ডেলিভারি/.test(t)) return "rider";
    if (/house ?owner|land ?owner|landlord|rent|বাড়িওয়ালা|ভাড়া/.test(t)) return "house_owner";
    if (/unemploy|bekar|jobless|বেকার/.test(t)) return "unemployed";
    if (/business|shop|trader|merchant|ব্যবসা|দোকান/.test(t)) return "businessman";
    if (/job|service|employee|officer|executive|engineer|teacher|doctor|banker|salaried|চাকরি|চাকুরি/.test(t)) return "job_holder";
    return null;
  }
  function mapRelation(txt) {
    const t = String(txt || "").toLowerCase();
    if (!t.trim()) return null;
    if (/father|dad|বাবা|পিতা/.test(t)) return "father";
    if (/mother|mom|মা\b|মাতা|আম্মু/.test(t)) return "mother";
    if (/brother|ভাই/.test(t)) return "brother";
    if (/sister|বোন/.test(t)) return "sister";
    if (/spouse|husband|wife|স্বামী|স্ত্রী|বউ/.test(t)) return "spouse";
    if (/colleague|co-?worker|কলিগ/.test(t)) return "colleague";
    if (/friend|বন্ধু/.test(t)) return "friend";
    if (/\bson\b|ছেলে|পুত্র/.test(t)) return "son";
    if (/\bdaughter\b|মেয়ে|কন্যা/.test(t)) return "daughter";
    if (/uncle|aunt|cousin|relative|in-?law|নিকট|চাচা|মামা|খালা|ফুফু|আত্মীয়/.test(t)) return "other_relative";
    return null;
  }
  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return Number.isFinite(n) && String(v).trim() !== "" ? n : null; };

  /* state (scraped + typed by the reviewer) -> {data, manual} for POST /api/check.
     ONLY numbers / flags / template ids. No name, phone, NID number, address, photo ever goes here. */
  function buildPayload(st, mrpFactor, ignored) {
    const f = mrpFactor || 0.9;
    const data = {};
    if (st.total_amount > 0) data.mrp = Math.round(st.total_amount * f);
    if (st.customer_age != null) data.customer_age = st.customer_age;
    if (st.guarantor_age != null) data.guarantor_age = st.guarantor_age;
    const prof = st.profession_key || (st.answers && st.answers.profession) || mapProfession(st.profession);
    if (prof) data.profession = prof;
    const rel = st.relation_key || (st.answers && st.answers.guarantor_relation) || mapRelation(st.relation);
    if (rel) data.guarantor_relation = rel;
    const dp = num(String(st.down_payment_pct || "").replace("%", ""));
    if (dp !== null) data.down_payment_pct = dp;
    if (st.has_salary_slip === true) data.salary_slip_submitted = true;
    if (st.stmt_best_month != null) data.tx_1_month = st.stmt_best_month;
    if (st.stmt_total_3m != null) data.tx_3_month = st.stmt_total_3m;
    if (st.stmt_months_covered != null) data.stmt_months_covered = st.stmt_months_covered;
    if (st.stmt_name_mismatch === true) data.name_mismatch = true;
    if (st.stmt_guarantor_relation && !data.guarantor_relation) data.guarantor_relation = st.stmt_guarantor_relation;

    Object.entries(st.answers || {}).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) data[k] = v; });
    const manual = [];
    const add = (tid, kind, key) => { if (!ignored || !ignored.has(key)) manual.push({ tid, kind, key }); };
    if (st.stmt_password_failed === true) add("stm.10", "return", "stmt:password");
    if (st.stmt_return_tid) add(st.stmt_return_tid, "return", "stmt:holder");
    const validSpouseProof = st.answers && ["marriage_certificate", "child_nid", "qr_birth_certificate"].includes(st.answers.spouse_proof);
    if (rel === "spouse" && Boolean(data.name_mismatch) && !String(st.guar_husband || "").trim() && !validSpouseProof && st.stmt_return_tid !== "stm.16") {
      add("stm.16", "return", "spouse:proof");
    }
    if (Array.isArray(st.stmt_forbidden_hits) && st.stmt_forbidden_hits.length) {
      st.stmt_forbidden_hits.forEach((hit) => add(hit.tid || "adr.11", "action", "stmt:app:" + hit.key));
    } else if (st.stmt_forbidden_hit === true) {
      add("adr.11", "action", "stmt:app:palmpay");
    }
    if (st.cust_nid_count > 0 && st.cust_nid_count < 2) add("nid.11", "return", "nid:cust-sides");
    if (st.guar_nid_count > 0 && st.guar_nid_count < 2) add("nid.12", "return", "nid:guar-sides");
    if (st.nid_mismatch) add("qi.25", "return", "nid:mismatch");
    (st.phone_findings || []).filter((x) => x.kind === "return").forEach((x) => add(x.tid, "return", x.key));
    if (st.has_onsite_photo === false) add("adr.06", "return", "att:onsite");
    if (st.has_signature === false) add("adr.07", "return", "att:signature");
    if (st.imei_photo_missing === true) add("adr.08", "return", "imei:photo-missing");
    if (st.imei_box_mismatch === true) add("adr.10", "return", "imei:box-mismatch");
    return { data, manual };
  }

  return { toAscii, digitsOf, normalizePhone, phoneChecks, luhnCheck, lookupImeiBrand, checkImei, parseImeiTexts, nidNumbersMatch, parseNidTexts, parseNidQrPayload, validateNidAuthenticity, ageFromIso, dhakaToday, mapProfession, mapRelation, buildPayload, isEmptyVal };
});
