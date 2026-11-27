/* upgrade.js - one-click self-update for the unpacked TopPay extension.
   Flow: fetch <UPDATE_BASE>/ext/ext-manifest.json -> compare sha256 with the files on disk ->
   download changed files -> verify sha256 -> back up old copies to backup-prev/ -> write into the
   user's extension folder (File System Access API) -> manifest.json LAST -> chrome.runtime.reload(). */
(function () {
  "use strict";
  const DEFAULT_BASE = "https://toppay-zeta.vercel.app";
  const BACKUP = "backup-prev";
  const $ = (id) => document.getElementById(id);
  const log = (m) => { $("log").textContent += m + "\n"; $("log").scrollTop = 1e9; };
  const setStatus = (html) => { $("status").innerHTML = html; };

  /* ---------- tiny IndexedDB key/value (to remember the folder handle) ---------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("toppay-upgrade", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idb();
    return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async function idbDel(k) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  /* ---------- helpers ---------- */
  async function base() {
    const { updateBase } = await chrome.storage.local.get("updateBase");
    return (updateBase || DEFAULT_BASE).replace(/\/+$/, "");
  }
  async function sha256(buf) {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function safePath(p) {
    if (typeof p !== "string" || !p || p.startsWith("/") || p.includes("\\") || p.split("/").some((s) => s === ".." || s === "" || s === ".")) throw new Error("Unsafe path in manifest: " + p);
    if (p.startsWith(BACKUP + "/")) throw new Error("Reserved path: " + p);
    return p;
  }
  async function localBytes(path) {
    try {
      const r = await fetch(chrome.runtime.getURL(path), { cache: "no-store" });
      return r.ok ? await r.arrayBuffer() : null;
    } catch (e) { return null; }
  }
  async function remoteManifest() {
    const r = await fetch((await base()) + "/ext/ext-manifest.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Server manifest পাওয়া যায়নি (HTTP " + r.status + "). /ext/ext-manifest.json push হয়েছে তো?");
    const m = await r.json();
    if (!m || !Array.isArray(m.files)) throw new Error("ext-manifest.json ভুল format");
    return m;
  }
  async function dirFor(root, path, create) {
    const parts = path.split("/"); const name = parts.pop(); let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return { d, name };
  }
  async function writeFile(root, path, data) {
    const { d, name } = await dirFor(root, path, true);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }
  async function readDirFile(root, path) {
    const { d, name } = await dirFor(root, path, false);
    return await (await (await d.getFileHandle(name)).getFile()).arrayBuffer();
  }
  async function listFiles(dir, prefix) {
    let out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === "directory") out = out.concat(await listFiles(h, prefix + name + "/"));
      else out.push(prefix + name);
    }
    return out;
  }

  /* ---------- folder handling ---------- */
  async function verifyDir(h) {
    let m;
    try { m = JSON.parse(new TextDecoder().decode(await readDirFile(h, "manifest.json"))); }
    catch (e) { throw new Error("এই folder-এ manifest.json নেই — ভুল folder বেছেছেন।"); }
    const cur = chrome.runtime.getManifest();
    if (m.name !== cur.name || m.version !== cur.version) throw new Error("এটা চালু extension-এর folder নয় (name/version মিলছে না). যে folder Load unpacked করেছেন সেটাই বাছুন।");
  }
  async function getDir(interactive) {
    let h = await idbGet("dir");
    if (h) {
      let p = await h.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && interactive) p = await h.requestPermission({ mode: "readwrite" });
      if (p === "granted") { try { await verifyDir(h); return h; } catch (e) { log("⚠ " + e.message); } }
    }
    if (!interactive) return null;
    log("📁 Extension folder বাছুন…");
    h = await window.showDirectoryPicker({ id: "toppay-ext", mode: "readwrite" });
    await verifyDir(h);
    await idbSet("dir", h);
    return h;
  }

  /* ---------- check ---------- */
  let pending = null; // { remote, changed:[{path,sha256,size}] }
  async function check() {
    $("btnUpgrade").disabled = true; pending = null;
    const local = chrome.runtime.getManifest().version;
    $("localV").textContent = local;
    try {
      const remote = await remoteManifest();
      $("remoteV").textContent = remote.version || "?";
      const changed = [];
      for (const f of remote.files) {
        safePath(f.path);
        const lb = await localBytes(f.path);
        if (!lb || (await sha256(lb)) !== f.sha256) changed.push(f);
      }
      if (!changed.length) { setStatus('<span class="ok">✅ আপনার extension আপ-টু-ডেট।</span>'); log("কোনো পরিবর্তন নেই।"); return; }
      pending = { remote, changed };
      setStatus('<span class="bad">🔔 নতুন আপডেট আছে</span> — ' + changed.length + "টি file বদলেছে।");
      log("বদলানো file:\n  " + changed.map((f) => f.path).join("\n  "));
      $("btnUpgrade").disabled = false;
    } catch (e) { setStatus('<span class="bad">❌ ' + e.message + "</span>"); log("ERROR: " + e.message); }
  }

  /* ---------- upgrade ---------- */
  async function upgrade() {
    if (!pending) return;
    $("btnUpgrade").disabled = true;
    try {
      const dir = await getDir(true);
      const b = await base();
      // 1) download + verify everything BEFORE touching the disk
      const blobs = [];
      for (const f of pending.changed) {
        log("⬇ " + f.path);
        const r = await fetch(b + "/ext/" + f.path.split("/").map(encodeURIComponent).join("/") + "?t=" + Date.now(), { cache: "no-store" });
        if (!r.ok) throw new Error(f.path + " download হয়নি (HTTP " + r.status + ")");
        const buf = await r.arrayBuffer();
        if ((await sha256(buf)) !== f.sha256) throw new Error(f.path + " checksum মেলেনি — কিছু লেখা হয়নি।");
        blobs.push({ f, buf });
      }
      // 2) back up current copies of the files we are about to replace
      try { await dir.removeEntry(BACKUP, { recursive: true }); } catch (e) { /* none yet */ }
      const oldVer = chrome.runtime.getManifest().version;
      for (const { f } of blobs) {
        const old = await localBytes(f.path);
        if (old) await writeFile(dir, BACKUP + "/" + f.path, old);
      }
      await writeFile(dir, BACKUP + "/backup-info.json", JSON.stringify({ version: oldVer, at: new Date().toISOString() }));
      log("💾 backup → " + BACKUP + "/ (version " + oldVer + ")");
      // 3) write files; manifest.json LAST so a half-finished update never bumps the version
      blobs.sort((a, c) => (a.f.path === "manifest.json") - (c.f.path === "manifest.json"));
      for (const { f, buf } of blobs) { await writeFile(dir, f.path, buf); log("✍ " + f.path); }
      setStatus('<span class="ok">✅ আপডেট শেষ। Extension reload হচ্ছে…</span>');
      log("Reloading extension…");
      setTimeout(() => chrome.runtime.reload(), 900);
    } catch (e) {
      setStatus('<span class="bad">❌ ' + (e.name === "AbortError" ? "Folder বাছা বাতিল হয়েছে" : e.message) + "</span>");
      log("ERROR: " + e.message); $("btnUpgrade").disabled = !pending;
    }
  }

  /* ---------- rollback ---------- */
  async function rollback() {
    try {
      const dir = await getDir(true);
      let info; try { info = JSON.parse(new TextDecoder().decode(await readDirFile(dir, BACKUP + "/backup-info.json"))); } catch (e) { throw new Error("কোনো backup নেই।"); }
      if (!confirm("Version " + info.version + "-এর backup ফিরিয়ে আনবেন?")) return;
      const files = (await listFiles(await dir.getDirectoryHandle(BACKUP), "")).filter((p) => p !== "backup-info.json");
      files.sort((a, c) => (a === "manifest.json") - (c === "manifest.json"));
      for (const p of files) { await writeFile(dir, p, await readDirFile(dir, BACKUP + "/" + p)); log("↩ " + p); }
      setStatus('<span class="ok">✅ Rollback শেষ। Reload হচ্ছে…</span>');
      setTimeout(() => chrome.runtime.reload(), 900);
    } catch (e) { setStatus('<span class="bad">❌ ' + e.message + "</span>"); log("ERROR: " + e.message); }
  }

  $("btnCheck").addEventListener("click", check);
  $("btnUpgrade").addEventListener("click", upgrade);
  $("btnRollback").addEventListener("click", rollback);
  $("btnReset").addEventListener("click", async () => { await idbDel("dir"); log("Folder ভুলে গেছি। পরের Upgrade-এ আবার বাছতে হবে।"); });
  $("localV").textContent = chrome.runtime.getManifest().version;
  check();
})();
