// Ultra-Fast Dual-Mode (Hologram-Safe + Red-Ink) Parallel OCR & Local PDF Analyzer
(function filterTesseractNoise() {
  const wrap = (orig) => function (...args) {
    if (args && args.length && typeof args[0] === "string" && args[0].includes("Estimating resolution as")) return;
    return orig.apply(this, args);
  };
  if (typeof console !== "undefined") {
    if (console.warn) console.warn = wrap(console.warn);
    if (console.info) console.info = wrap(console.info);
  }
})();
const POOL_SIZE = 2;
const workers = new Array(POOL_SIZE).fill(null);
const workerBusy = new Array(POOL_SIZE).fill(false);
const waitQueue = [];
const pdfBufCache = new Map();

if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");
}

function createOneWorker() {
  return Tesseract.createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL("lib/worker.min.js"),
    corePath: chrome.runtime.getURL("lib/"),
    langPath: chrome.runtime.getURL("lib"),
    gzip: false,
    workerBlobURL: false
  });
}

function getWorkerSlot(idx) {
  if (!workers[idx]) workers[idx] = createOneWorker();
  return workers[idx];
}

setTimeout(() => { getWorkerSlot(0).catch(() => {}); }, 5);

function acquireWorker() {
  return new Promise((resolve) => {
    const tryGrab = () => {
      for (let i = 0; i < POOL_SIZE; i++) {
        if (!workerBusy[i]) {
          workerBusy[i] = true;
          getWorkerSlot(i).then((w) => resolve({
            worker: w,
            release: () => {
              workerBusy[i] = false;
              if (waitQueue.length) waitQueue.shift()();
            }
          })).catch((err) => {
            workerBusy[i] = false;
            if (waitQueue.length) waitQueue.shift()();
            throw err;
          });
          return;
        }
      }
      waitQueue.push(tryGrab);
    };
    tryGrab();
  });
}

function stripResizeQuery(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has("x-oss-process")) {
      u.searchParams.delete("x-oss-process");
      return u.toString();
    }
  } catch { /* ignore */ }
  return url;
}

function loadRawImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = async () => {
      try {
        const res = await fetch(url, { credentials: "omit" });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.type && blob.type.startsWith("image/")) {
            const bmp = await createImageBitmap(blob);
            return resolve(bmp);
          }
        }
      } catch { /* fallback to background fetch */ }
      try {
        chrome.runtime.sendMessage({ type: "fetchDataUrl", url }, (r) => {
          if (chrome.runtime.lastError || !r || !r.ok || !r.dataUrl) {
            return reject(new Error((r && r.error) || "ছবি লোড হয়নি"));
          }
          const img2 = new Image();
          img2.onload = () => resolve(img2);
          img2.onerror = () => reject(new Error("ছবি ডিকোড করা যায়নি"));
          img2.src = r.dataUrl;
        });
      } catch (e) {
        reject(e);
      }
    };
    img.src = url;
  });
}

async function loadImageElement(url) {
  const fullUrl = stripResizeQuery(url);
  if (fullUrl !== url) {
    try { return await loadRawImage(fullUrl); } catch { /* fallback to original url */ }
  }
  return loadRawImage(url);
}

// Mode A: Standard Luminance Grayscale (Hologram-safe for Smart NIDs)
// Pink/iridescent holograms stay bright so black text underneath ("25 Apr 1986", "281 996 9235") stays readable!
function enhanceStandardGrayscale(canvas, gamma) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  let lo = 255, hi = 0;
  const x0 = Math.floor(w * 0.1), x1 = Math.floor(w * 0.9);
  const y0 = Math.floor(h * 0.1), y1 = Math.floor(h * 0.9);
  for (let y = y0; y < y1; y += 3) {
    let row = y * w * 4;
    for (let x = x0; x < x1; x += 3) {
      const i = row + x * 4;
      const lum = d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15;
      if (lum < lo) lo = lum;
      if (lum > hi) hi = lum;
    }
  }
  const span = Math.max(45, hi - lo);
  const g = gamma || 1.35;

  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.35 + d[i + 1] * 0.5 + d[i + 2] * 0.15;
    let norm = (lum - lo) / span;
    if (norm < 0) norm = 0;
    else if (norm > 1) norm = 1;
    norm = Math.pow(norm, g);
    const v = norm > 0.68 ? 255 : Math.max(0, Math.min(255, Math.round(norm * 255)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Mode B: Red-Ink Enhancer (Green/Blue channel) for old laminated NIDs
// Turns red-ink "Date of Birth: 31 Dec 1997" & "ID NO: 4214267173" jet-black!
function enhanceRedAndBlackInk(canvas, boost) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  let lo = 255, hi = 0;
  const x0 = Math.floor(w * 0.12), x1 = Math.floor(w * 0.88);
  const y0 = Math.floor(h * 0.12), y1 = Math.floor(h * 0.88);
  for (let y = y0; y < y1; y += 3) {
    let row = y * w * 4;
    for (let x = x0; x < x1; x += 3) {
      const i = row + x * 4;
      const gb = d[i + 1] < d[i + 2] ? d[i + 1] : d[i + 2];
      if (gb < lo) lo = gb;
      if (gb > hi) hi = gb;
    }
  }
  const span = Math.max(40, hi - lo);
  const gamma = boost || 1.5;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gb = g < b ? g : b;
    // Suppress red-channel dominance so red-ink DOB on warm laminated/temporary NIDs turns dark
    const redExcess = Math.max(0, r - gb);
    const raw = Math.max(0, gb * 0.90 + r * 0.10 - redExcess * 0.45);
    let norm = (raw - lo) / span;
    if (norm < 0) norm = 0;
    else if (norm > 1) norm = 1;
    norm = Math.pow(norm, gamma);
    const v = norm > 0.64 ? 255 : Math.max(0, Math.min(255, Math.round(norm * 255)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}


// Mode C: Integral-Image Adaptive Thresholding (handles uneven shadows & glare on NID cards)
function enhanceAdaptiveLocal(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
    }
  }

  const radius = Math.max(12, Math.floor(w / 48));
  const t = 0.14;
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(w - 1, x + radius);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      const mean = sum / count;
      const idx = y * w + x;
      const v = gray[idx] < mean * (1 - t) ? 0 : 255;
      const p4 = idx * 4;
      d[p4] = d[p4 + 1] = d[p4 + 2] = v;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Lightweight Image Forensics: detects digitally flat backgrounds / synthetic sharp overlays / screenshots
function analyzeImageForensics(img) {
  try {
    const c = document.createElement("canvas");
    const w0 = img.naturalWidth || img.width || 320;
    const h0 = img.naturalHeight || img.height || 200;
    const w = 320;
    const h = Math.max(180, Math.round((h0 / Math.max(1, w0)) * 320));
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;

    let flatPairs = 0, totalPairs = 0, highJumpPairs = 0;
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const i = (y * w + x) * 4;
        const j = (y * w + (x + 1)) * 4;
        const diff = Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
        totalPairs++;
        if (diff === 0) flatPairs++;
        if (diff > 240) highJumpPairs++;
      }
    }

    const flatRatio = flatPairs / Math.max(1, totalPairs);
    const sharpRatio = highJumpPairs / Math.max(1, totalPairs);
    const flags = [];
    if (flatRatio > 0.38) flags.push("digitally_flat_background");
    if (sharpRatio > 0.14) flags.push("synthetic_sharp_overlay");

    return {
      suspicious: flags.length > 0,
      flatRatio: Math.round(flatRatio * 100),
      sharpRatio: Math.round(sharpRatio * 100),
      flags
    };
  } catch {
    return { suspicious: false, flatRatio: 0, sharpRatio: 0, flags: [] };
  }
}


// Mode D: Red-Channel Cyan-Guilloche Eraser (erases cyan/blue security waves over Smart NID numbers)
function enhanceCyanGuillocheSafe(canvas, gamma) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width, h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  let lo = 255, hi = 0;
  const x0 = Math.floor(w * 0.08), x1 = Math.floor(w * 0.92);
  const y0 = Math.floor(h * 0.08), y1 = Math.floor(h * 0.92);
  for (let y = y0; y < y1; y += 2) {
    let row = y * w * 4;
    for (let x = x0; x < x1; x += 2) {
      const r = d[row + x * 4];
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
  }
  const span = Math.max(40, hi - lo);
  const g = gamma || 1.25;

  for (let i = 0; i < d.length; i += 4) {
    // Pure Red channel keeps cyan/blue guilloche lines white while black ink stays dark
    const r = d[i];
    let norm = (r - lo) / span;
    if (norm < 0) norm = 0;
    else if (norm > 1) norm = 1;
    norm = Math.pow(norm, g);
    const v = norm > 0.72 ? 255 : Math.max(0, Math.min(255, Math.round(norm * 255)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// mode: "gray" | "red" | "adaptive" | "cyan_safe" | null
function renderCanvas(img, targetWidth, deg, cropRect, mode, gamma) {
  const w0 = img.naturalWidth || img.width || 800;
  const h0 = img.naturalHeight || img.height || 500;
  const sx = cropRect ? Math.round(w0 * cropRect.sx) : 0;
  const sy = cropRect ? Math.round(h0 * cropRect.sy) : 0;
  const sw = cropRect ? Math.max(40, Math.round(w0 * cropRect.sw)) : w0;
  const sh = cropRect ? Math.max(40, Math.round(h0 * cropRect.sh)) : h0;

  const width = Math.max(targetWidth, Math.min(sw, 1800));
  const h = Math.round((sh * width) / sw);
  const sideways = Math.abs(deg) === 90 || Math.abs(deg) === 270;

  const c = document.createElement("canvas");
  c.width = sideways ? h : width;
  c.height = sideways ? width : h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);

  if (deg) {
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(img, sx, sy, sw, sh, -width / 2, -h / 2, width, h);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  }
  if (mode === "gray") enhanceStandardGrayscale(c, gamma || 1.35);
  else if (mode === "red") enhanceRedAndBlackInk(c, gamma || 1.5);
  else if (mode === "adaptive") enhanceAdaptiveLocal(c);
  else if (mode === "cyan_safe") enhanceCyanGuillocheSafe(c, gamma || 1.25);
  return c;
}

const hasNidNum = (texts) => {
  const joined = texts.join("\n");
  return /\d(?:[\s-]?\d){9,}/.test(joined) || /I<BGD\d{9}<\d/i.test(joined);
};

const hasDob = (texts) => {
  const joined = texts.join("\n");
  return /[\dOlI]{1,2}[\s.,/-]*[A-Za-z01458]{3}[A-Za-z]*[\s.,/-]*(?:19|20)\d{2}/.test(joined)
    || /\b\d{6}\d[MF]\d{6,7}BGD/i.test(joined)
    || /(?:BIRTH|DOB)[^0-9]{0,14}\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}/i.test(joined);
};

const hasNidAndDob = (texts) => hasNidNum(texts) && hasDob(texts);

const hasAnyUseful = (texts) => {
  const joined = texts.join("\n");
  return hasNidNum(texts) || hasDob(texts) || /address|blood\s*group|issue\s*date|place\s*of\s*birth/i.test(joined);
};

async function fetchPdfBuffer(url) {
  if (pdfBufCache.has(url)) return pdfBufCache.get(url).slice(0);
  let buf = null;
  try {
    const r = await fetch(url, { credentials: "include" });
    if (r.ok) buf = await r.arrayBuffer();
  } catch { /* retry without credentials for signed OSS/S3 URLs */ }
  if (!buf) {
    try {
      const r2 = await fetch(url, { credentials: "omit" });
      if (r2.ok) buf = await r2.arrayBuffer();
    } catch { /* fallback to background service worker fetch (bypasses CORS) */ }
  }
  if (!buf) {
    buf = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: "fetchDataUrl", url, timeout: 15000 }, (r) => {
          if (chrome.runtime.lastError || !r || !r.ok || !r.dataUrl) {
            return reject(new Error((r && r.error) || "PDF ডাউনলোড হয়নি"));
          }
          const idx = r.dataUrl.indexOf(",");
          const b64 = idx >= 0 ? r.dataUrl.slice(idx + 1) : "";
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          resolve(bytes.buffer);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  if (pdfBufCache.size > 15) pdfBufCache.clear();
  pdfBufCache.set(url, buf.slice(0));
  return buf;
}

function isPdfMagic(buf) {
  if (!buf || buf.byteLength < 5) return false;
  const b = new Uint8Array(buf, 0, 5);
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

function detectImageMime(buf) {
  if (!buf || buf.byteLength < 12) return "";
  const b = new Uint8Array(buf, 0, 12);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

async function scanQrAndBarcodes(img) {
  const found = [];
  const seen = new Set();
  if (typeof BarcodeDetector === "undefined") return found;

  let detector = null;
  try {
    const wanted = ["qr_code", "pdf417", "aztec", "data_matrix", "code_128"];
    let formats = wanted;
    if (typeof BarcodeDetector.getSupportedFormats === "function") {
      const sup = await BarcodeDetector.getSupportedFormats();
      const filtered = wanted.filter((f) => sup.includes(f));
      if (filtered.length) formats = filtered;
    }
    detector = new BarcodeDetector({ formats });
  } catch {
    try { detector = new BarcodeDetector(); } catch { return found; }
  }

  const pushHits = (codes) => {
    for (const c of codes || []) {
      const raw = String(c && c.rawValue ? c.rawValue : "").trim();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      found.push({ format: c.format || "qr_code", rawValue: raw });
    }
  };

  const tryDetect = async (source) => {
    try {
      const codes = await detector.detect(source);
      pushHits(codes);
    } catch { /* ignore single-pass detect error */ }
  };

  // 1. Direct full-resolution image
  await tryDetect(img);
  if (found.length) return found;

  // 2. Rotated full card + Smart NID top PDF417 zone + Temporary NID bottom PDF417 zone + QR zones
  const passes = [
    // Smart NID PDF417 barcode sits in the upper band of the back card
    [1900, 0, { sx: 0.0, sy: 0.0, sw: 1.0, sh: 0.48 }, null, 1.0],
    [1900, 0, { sx: 0.0, sy: 0.0, sw: 1.0, sh: 0.48 }, "gray", 1.15],
    // Temporary NID PDF417 barcode sits in the lower band of the back card
    [2000, 0, { sx: 0.05, sy: 0.46, sw: 0.90, sh: 0.46 }, null, 1.0],
    [2000, 0, { sx: 0.05, sy: 0.46, sw: 0.90, sh: 0.46 }, "gray", 1.15],
    [1600, 0, null, "gray", 1.15],
    [1600, 90, null, null, 1.0],
    [1600, 270, null, null, 1.0],
    [1600, 180, null, null, 1.0],
    [1600, 90, null, "gray", 1.15],
    [1600, 0, { sx: 0.45, sy: 0.0, sw: 0.55, sh: 1.0 }, null, 1.0],
    [1600, 0, { sx: 0.0, sy: 0.0, sw: 0.55, sh: 1.0 }, null, 1.0],
  ];
  for (const [w, deg, crop, mode, gamma] of passes) {
    const cvs = renderCanvas(img, w, deg, crop, mode, gamma);
    await tryDetect(cvs);
    if (found.length) break;
  }
  return found;
}

window.addEventListener("message", async (e) => {
  const m = e.data;
  if (!m) return;

  if (m.type === "warmup") {
    getWorkerSlot(0).catch(() => {});
    return;
  }

  if (m.type === "ocr-request") {
    let slot = null;
    try {
      const img = await loadImageElement(m.url);
      const forensics = m.mode === "viewer" ? null : analyzeImageForensics(img);
      const qrCodes = m.mode === "viewer" ? [] : await scanQrAndBarcodes(img);
      const texts = [];
      qrCodes.forEach((q) => {
        if (q && q.rawValue) texts.push(q.rawValue);
      });

      // If scanning the back of NID and QR/PDF417 already yielded NID + DOB, return immediately!
      if (m.side === "back" && qrCodes.length > 0 && hasNidAndDob(texts)) {
        e.source.postMessage({ type: "ocr-result", id: m.id, texts, qrCodes, forensics, complete: true }, "*");
        return;
      }

      slot = await acquireWorker();
      const w = slot.worker;
      const w0 = img.naturalWidth || img.width || 800;
      const h0 = img.naturalHeight || img.height || 500;
      const isPortrait = h0 > w0 * 1.15;
      const cropBox = { sx: 0.14, sy: 0.16, sw: 0.80, sh: 0.80 };
      const hasImei = (arr) => /\b\d{15}\b/.test(arr.join("\n").replace(/[^0-9\n]/g, ""));

      if (m.mode === "viewer") {
        // Viewer preview can be an upright phone box (portrait), statement screenshot, or NID card!
        await w.setParameters({ tessedit_pageseg_mode: "6" });
        const rUp = await w.recognize(renderCanvas(img, 1650, 0, null, "gray", 1.25));
        if (rUp && rUp.data && rUp.data.text) texts.push(rUp.data.text);

        // High-res focused box sticker zone pass so BOTH IMEI1 and IMEI2 are captured cleanly
        const hasSysImei = m.sys && texts.join("\n").replace(/\D/g, "").includes(m.sys);
        if (!hasNidAndDob(texts) && !hasSysImei) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rSticker = await w.recognize(renderCanvas(img, 2000, 0, { sx: 0.15, sy: 0.44, sw: 0.70, sh: 0.32 }, "gray", 1.32));
          if (rSticker && rSticker.data && rSticker.data.text) texts.push(rSticker.data.text);
        }

        // High-res Red-ink pass for old laminated & Temporary NIDs opened in lightbox preview
        if (!hasImei(texts) && !hasNidAndDob(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rViewRed = await w.recognize(renderCanvas(img, 1850, 0, { sx: 0.15, sy: 0.32, sw: 0.75, sh: 0.58 }, "red", 1.65));
          if (rViewRed && rViewRed.data && rViewRed.data.text) texts.push(rViewRed.data.text);
        }
        // If still no IMEI and no NID+DOB, try rotated 90deg / 270deg (sideways NID card in viewer)
        if (!hasImei(texts) && !hasNidAndDob(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rRot90 = await w.recognize(renderCanvas(img, 1400, 90, null, "gray", 1.35));
          if (rRot90 && rRot90.data && rRot90.data.text) texts.push(rRot90.data.text);
        }
        if (!hasImei(texts) && !hasNidAndDob(texts)) {
          const rRotRed = await w.recognize(renderCanvas(img, 1400, 90, null, "red", 1.55));
          if (rRotRed && rRotRed.data && rRotRed.data.text) texts.push(rRotRed.data.text);
        }
      } else if (!isPortrait) {
        if (m.side === "back") {
          // Back NID: Dedicated crisp grayscale pass on bottom MRZ zone (I<BGD... & YYMMDD...BGD)
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rMrz = await w.recognize(renderCanvas(img, 1650, 0, { sx: 0.02, sy: 0.48, sw: 0.96, sh: 0.50 }, "gray", 1.22));
          if (rMrz && rMrz.data && rMrz.data.text) texts.push(rMrz.data.text);
        }
        if (!hasNidAndDob(texts)) {
          // Pass 1: Hologram-safe Standard Grayscale on center-right data zone (reads Smart NIDs fast!)
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rGray = await w.recognize(renderCanvas(img, 1300, 0, cropBox, "gray", 1.32));
          if (rGray && rGray.data && rGray.data.text) texts.push(rGray.data.text);
        }
        // Pass 2: High-res Red-Ink channel pass on info column (reads tiny red-ink DOB on old laminated NIDs!)
        if (!hasNidAndDob(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rRed = await w.recognize(renderCanvas(img, 1800, 0, { sx: 0.16, sy: 0.32, sw: 0.75, sh: 0.60 }, "red", 1.65));
          if (rRed && rRed.data && rRed.data.text) texts.push(rRed.data.text);
        }
        // Pass 2.5: Red-Channel Cyan-Guilloche Eraser on Smart NID data & NID No zone
        const sysDigits = m.sys ? String(m.sys).replace(/\D/g, "") : "";
        const joinedDigits = texts.join("\n").replace(/\D/g, "");
        if (m.side !== "back" && (!hasNidNum(texts) || (sysDigits && !joinedDigits.includes(sysDigits)))) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rCyanStrip = await w.recognize(renderCanvas(img, 1950, 0, { sx: 0.35, sy: 0.55, sw: 0.62, sh: 0.40 }, "cyan_safe", 1.22));
          if (rCyanStrip && rCyanStrip.data && rCyanStrip.data.text) texts.push(rCyanStrip.data.text);
        }
      } else {
        // Portrait NID photo: rotate 90deg with standard grayscale, then red-ink if needed
        await w.setParameters({ tessedit_pageseg_mode: "6" });
        const rRot1 = await w.recognize(renderCanvas(img, 1250, 90, null, "gray", 1.35));
        if (rRot1 && rRot1.data && rRot1.data.text) texts.push(rRot1.data.text);
        if (!hasNidAndDob(texts)) {
          const rRotRed = await w.recognize(renderCanvas(img, 1250, 90, null, "red", 1.55));
          if (rRotRed && rRotRed.data && rRotRed.data.text) texts.push(rRotRed.data.text);
        }
      }

      // Pass 3 (Fallback): Full card scan if crop didn't capture both NID & DOB
      if (m.mode !== "viewer" && !hasNidAndDob(texts)) {
        if (isPortrait && !hasAnyUseful(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rUpFallback = await w.recognize(renderCanvas(img, 1300, 0, null, "gray", 1.35));
          if (rUpFallback && rUpFallback.data && rUpFallback.data.text) texts.push(rUpFallback.data.text);
        }
        if (isPortrait && !hasAnyUseful(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const rRot2 = await w.recognize(renderCanvas(img, 1250, 270, null, "gray", 1.4));
          if (rRot2 && rRot2.data && rRot2.data.text) texts.push(rRot2.data.text);
        }
        if (!hasNidAndDob(texts)) {
          await w.setParameters({ tessedit_pageseg_mode: "6" });
          const modeFull = hasNidNum(texts) ? "red" : "gray";
          const rFull = await w.recognize(renderCanvas(img, 1400, isPortrait ? 90 : 0, null, modeFull, 1.55));
          if (rFull && rFull.data && rFull.data.text) texts.push(rFull.data.text);
        }
      }

      // Pass 4 (Fallback for tilted/skewed cards like -11deg / +11deg):
      if (!hasNidAndDob(texts) && !isPortrait) {
        await w.setParameters({ tessedit_pageseg_mode: "11" });
        const modeTilt = hasNidNum(texts) ? "red" : "gray";
        const rTilt1 = await w.recognize(renderCanvas(img, 1350, -11, null, modeTilt, 1.55));
        if (rTilt1 && rTilt1.data && rTilt1.data.text) texts.push(rTilt1.data.text);
      }
      if (!hasNidAndDob(texts) && !isPortrait) {
        await w.setParameters({ tessedit_pageseg_mode: "11" });
        const rTilt2 = await w.recognize(renderCanvas(img, 1350, 11, null, "red", 1.6));
        if (rTilt2 && rTilt2.data && rTilt2.data.text) texts.push(rTilt2.data.text);
      }

      // Pass 3.5 (Adaptive Local Thresholding fallback for uneven shadows/glare)
      if (!hasNidAndDob(texts) && !isPortrait && m.mode !== "viewer") {
        await w.setParameters({ tessedit_pageseg_mode: "6" });
        const rAdapt = await w.recognize(renderCanvas(img, 1500, 0, cropBox, "adaptive", 1.0));
        if (rAdapt && rAdapt.data && rAdapt.data.text) texts.push(rAdapt.data.text);
      }

      e.source.postMessage({ type: "ocr-result", id: m.id, texts, qrCodes, forensics, complete: hasNidAndDob(texts) }, "*");
    } catch (err) {
      e.source.postMessage({ type: "ocr-result", id: m.id, error: String((err && err.message) || err) }, "*");
    } finally {
      if (slot) slot.release();
    }
    return;
  }

  if (m.type === "pdf-request") {
    try {
      const buf = m.buffer ? m.buffer : await fetchPdfBuffer(m.url);
      if (isPdfMagic(buf)) {
        const { lines, structuredRows, meta } = await window.TPStmtPdf.extract(buf, m.passwords || []);
        const analysis = window.TPStmt.analyze({
          lines,
          structuredRows,
          meta,
          customerName: m.customerName || "",
          guarantorName: m.guarantorName || "",
          guarantorRelation: m.guarantorRelation || "",
          customerFather: m.customerFather || "",
          customerMother: m.customerMother || "",
          guarantorFather: m.guarantorFather || "",
          guarantorMother: m.guarantorMother || "",
          guarantorHusband: m.guarantorHusband || "",
          spouseProof: m.spouseProof || "",
          appDate: m.appDate || "",
          cfg: m.cfg || {},
          lang: m.lang || "bn",
        });
        e.source.postMessage({ type: "pdf-result", id: m.id, analysis, unlockedWith: meta.unlockedWith || "" }, "*");
      } else {
        const imgMime = detectImageMime(buf);
        if (!imgMime) {
          throw new Error("Attachment-টি PDF বা ছবি নয় (PDF ফাইল বাছুন বা Attachment Preview খুলুন)।");
        }
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: imgMime }));
        let slot = null;
        try {
          const [img, s] = await Promise.all([loadImageElement(blobUrl), acquireWorker()]);
          slot = s;
          await slot.worker.setParameters({ tessedit_pageseg_mode: "6" });
          const { data } = await slot.worker.recognize(renderCanvas(img, 1400, 0, null, "gray", 1.35));
          const lines = (data && data.text ? data.text.split(/\r?\n/) : []).map((x) => x.trim()).filter(Boolean);
          const analysis = window.TPStmt.analyze({
            lines,
            structuredRows: [],
            meta: { producer: "Image Attachment", textChars: (data && data.text ? data.text.length : 0) },
            customerName: m.customerName || "",
            guarantorName: m.guarantorName || "",
            guarantorRelation: m.guarantorRelation || "",
            customerFather: m.customerFather || "",
            customerMother: m.customerMother || "",
            guarantorFather: m.guarantorFather || "",
            guarantorMother: m.guarantorMother || "",
            guarantorHusband: m.guarantorHusband || "",
            spouseProof: m.spouseProof || "",
            appDate: m.appDate || "",
            cfg: m.cfg || {},
            lang: m.lang || "bn",
          });
          e.source.postMessage({ type: "pdf-result", id: m.id, analysis, isImageAttachment: true }, "*");
        } finally {
          if (slot) slot.release();
          URL.revokeObjectURL(blobUrl);
        }
      }
    } catch (err) {
      e.source.postMessage({
        type: "pdf-result",
        id: m.id,
        error: String((err && err.message) || err),
        passwordFailed: !!(err && err.passwordFailed),
      }, "*");
    }
  }
});

parent.postMessage({ type: "ocr-ready" }, "*");
