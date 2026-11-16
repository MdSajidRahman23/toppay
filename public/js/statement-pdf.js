/* statement-pdf.js - reads a PDF with pdf.js IN THE BROWSER and returns {lines, meta}. Nothing is uploaded.
   Needs window.pdfjsLib (vendor/pdfjs/pdf.min.js). Not DOM-dependent otherwise. */
(function (root) {
  "use strict";

  function setup() {
    const lib = root.pdfjsLib;
    if (!lib) throw new Error("pdf.js লোড হয়নি");
    if (!lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
    return lib;
  }

  // text items -> lines: group by y (page by page), then order by x
  function itemsToLines(items, tol) {
    const rows = [];
    items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) <= tol);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s: it.str });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join("  ").replace(/\s{3,}/g, "  ").trim());
  }

  // number of "%%EOF" markers ~ number of saved revisions (incremental saves add one each time)
  function countRevisions(bytes) {
    let n = 0;
    const needle = [0x25, 0x25, 0x45, 0x4f, 0x46];
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

  /* extract(arrayBuffer, [passwords]) -> {lines, meta, pages} */
  async function extract(buffer, passwords) {
    const lib = setup();
    const bytes = new Uint8Array(buffer);
    const { doc } = await openWithPasswords(lib, bytes, passwords || []);
    const lines = [];
    let images = 0, chars = 0;
    const fonts = new Set();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      tc.items.forEach((it) => { chars += (it.str || "").length; if (it.fontName) fonts.add(it.fontName); });
      lines.push(...itemsToLines(tc.items, 3));
      try {
        const ops = await page.getOperatorList();
        const O = lib.OPS;
        ops.fnArray.forEach((f) => { if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject) images++; });
      } catch { /* image counting is optional */ }
    }
    let info = {};
    try { info = (await doc.getMetadata()).info || {}; } catch { /* no metadata */ }
    const meta = {
      producer: info.Producer || "", creator: info.Creator || "", creationDate: info.CreationDate || "", modDate: info.ModDate || "",
      revisions: countRevisions(bytes), pages: doc.numPages, images, fonts: fonts.size, textChars: chars,
    };
    return { lines, meta, pages: doc.numPages };
  }

  root.TPStmtPdf = { extract, itemsToLines, countRevisions };
  if (typeof module === "object" && module.exports) module.exports = root.TPStmtPdf;
})(typeof self !== "undefined" ? self : this);
