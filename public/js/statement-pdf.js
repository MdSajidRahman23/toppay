/* statement-pdf.js - reads a PDF with pdf.js IN THE BROWSER and returns {lines, structuredRows, meta}. Nothing is uploaded. */
(function (root) {
  "use strict";

  function setup() {
    const lib = root.pdfjsLib;
    if (!lib) throw new Error("pdf.js লোড হয়নি");
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
    return lib;
  }

  function itemsToRows(items, tol) {
    const rows = [];
    let lastValidY = null;
    let seqX = 1000;
    items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      let y = it.transform[5], x = it.transform[4];
      if (x === 0 && y === 0 && lastValidY !== null) {
        y = lastValidY;
        x = ++seqX;
      } else {
        lastValidY = y;
        seqX = Math.max(1000, x + 100);
      }
      let row = rows.find((r) => Math.abs(r.y - y) <= tol);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str, fontName: it.fontName || "" });
    });
    rows.sort((a, b) => b.y - a.y);
    rows.forEach((r) => r.parts.sort((a, b) => a.x - b.x));
    return rows;
  }

  function rowsToLines(rows) {
    return rows.map((r) => r.parts.map((p) => p.s).join("  ").replace(/\s{3,}/g, "  ").trim());
  }

  function countRevisions(bytes) {
    let n = 0;
    for (let i = 0; i <= bytes.length - 5; i++) {
      if (bytes[i] === 0x25 && bytes[i + 1] === 0x25 && bytes[i + 2] === 0x45 && bytes[i + 3] === 0x4f && bytes[i + 4] === 0x46) n++;
    }
    return n;
  }

  async function openWithPasswords(lib, bytes, passwords) {
    const tries = [""].concat(passwords.filter(Boolean));
    let needed = false;
    for (const pw of tries) {
      try {
        const task = lib.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false });
        return { doc: await task.promise, used: pw };
      } catch (e) {
        if (e && (e.name === "PasswordException" || e.code === 1 || e.code === 2)) { needed = true; continue; }
        throw e;
      }
    }
    const err = new Error(needed ? "PDF-এ password আছে এবং দেওয়া password মেলেনি।" : "PDF খোলা যায়নি।");
    err.passwordFailed = needed;
    throw err;
  }

  function extractRawBaseFonts(bytes) {
    const found = new Set();
    try {
      const latin = new TextDecoder("latin1").decode(bytes);
      const re = /\/(?:BaseFont|FontName)\s*\/([A-Za-z0-9_+.-]+)/g;
      let m;
      while ((m = re.exec(latin))) {
        const fn = m[1].trim();
        if (fn && !/^g_d\d+_f\d+$/i.test(fn)) found.add(fn);
      }
    } catch { /* optional */ }
    return found;
  }

  function resolveFontObjectName(page, fontId) {
    const pools = [page && page.commonObjs, page && page.objs];
    for (const pool of pools) {
      if (!pool || typeof pool.get !== "function") continue;
      try {
        const fo = pool.get(fontId);
        if (!fo) continue;
        const cands = [fo.name, fo.fallbackName, fo.loadedName];
        for (const cand of cands) {
          const s = String(cand || "").replace(/^\//, "").trim();
          if (s && !/^g_d\d+_f\d+$/i.test(s)) return s;
        }
      } catch { /* not resolved yet */ }
    }
    return "";
  }

  async function extract(buffer, passwords) {
    const lib = setup();
    const bytes = new Uint8Array(buffer);
    const { doc, used } = await openWithPasswords(lib, bytes, passwords || []);
    const lines = [];
    const structuredRows = [];
    let images = 0, chars = 0;
    const fontIds = new Set();
    const realFonts = extractRawBaseFonts(bytes);

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      try {
        const ops = await page.getOperatorList();
        const O = lib.OPS;
        ops.fnArray.forEach((f) => {
          if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject) images++;
        });
      } catch { /* optional */ }

      tc.items.forEach((it) => {
        chars += (it.str || "").length;
        if (it.fontName) {
          fontIds.add(it.fontName);
          const resolved = resolveFontObjectName(page, it.fontName);
          if (resolved) realFonts.add(resolved);
        }
      });

      const pageRows = itemsToRows(tc.items, 2.8);
      pageRows.forEach((r) => {
        structuredRows.push({
          page: p,
          y: r.y,
          parts: r.parts.map((pt) => ({ x: pt.x, s: pt.s })),
          text: r.parts.map((pt) => pt.s).join("  ").replace(/\s{3,}/g, "  ").trim(),
        });
      });
      lines.push(...rowsToLines(pageRows));
    }

    let info = {};
    try { info = (await doc.getMetadata()).info || {}; } catch { /* no metadata */ }
    const meta = {
      producer: info.Producer || "",
      creator: info.Creator || "",
      author: info.Author || "",
      title: info.Title || "",
      creationDate: info.CreationDate || "",
      modDate: info.ModDate || "",
      revisions: countRevisions(bytes),
      pages: doc.numPages,
      images,
      fonts: fontIds.size,
      fontNames: [...realFonts],
      textChars: chars,
      unlockedWith: used || "",
      isEncrypted: Boolean(used),
    };
    return { lines, structuredRows, meta, pages: doc.numPages };
  }

  root.TPStmtPdf = { extract, itemsToRows, countRevisions };
  if (typeof module === "object" && module.exports) module.exports = root.TPStmtPdf;
})(typeof self !== "undefined" ? self : this);
