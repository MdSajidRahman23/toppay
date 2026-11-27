"""publish_ext.py - copy the Chrome extension into public/ext and write public/ext/ext-manifest.json.

Usage (from the toppay-web folder):
    python tools/publish_ext.py D:\\toppay-ext
    python tools/publish_ext.py D:\\toppay-ext --include-vendor     (also publish big libs: wasm, traineddata, pdf.js...)

Then:  git add .  &&  git commit -m "ext vX.Y.Z"  &&  git push     (Vercel redeploys; users click Upgrade).
The extension's upgrade page compares sha256 of every listed file and only downloads what changed.
It never deletes local files, so skipped vendor libs simply stay as they are.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time

SKIP_DIRS = {".git", "node_modules", "backup-prev", "__pycache__", "tests", ".vscode"}
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
VENDOR = {  # big third-party files that almost never change
    "lib/eng.traineddata", "lib/pdf.min.js", "lib/pdf.worker.min.js", "lib/tesseract.min.js", "lib/worker.min.js",
    "lib/tesseract-core.wasm.js", "lib/tesseract-core-simd.wasm.js",
    "lib/tesseract-core-lstm.wasm.js", "lib/tesseract-core-simd-lstm.wasm.js",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ext_dir", help="path of the extension folder (the one with manifest.json)")
    ap.add_argument("--web", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."),
                    help="toppay-web folder (default: parent of tools/)")
    ap.add_argument("--include-vendor", action="store_true")
    a = ap.parse_args()

    src = os.path.abspath(a.ext_dir)
    web = os.path.abspath(a.web)
    mpath = os.path.join(src, "manifest.json")
    if not os.path.isfile(mpath):
        sys.exit("manifest.json not found in " + src)
    with open(mpath, encoding="utf-8") as f:
        man = json.load(f)
    if not os.path.isdir(os.path.join(web, "public")):
        sys.exit("public/ not found in " + web + " - run from the toppay-web folder")

    out = os.path.join(web, "public", "ext")
    old = {}
    try:
        with open(os.path.join(out, "ext-manifest.json"), encoding="utf-8") as f:
            old = {x["path"]: x["sha256"] for x in json.load(f)["files"]}
    except Exception:
        pass
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)

    files, skipped = [], []
    for root, dirs, names in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for n in sorted(names):
            if n in SKIP_NAMES:
                continue
            full = os.path.join(root, n)
            rel = os.path.relpath(full, src).replace(os.sep, "/")
            if rel in VENDOR and not a.include_vendor:
                skipped.append(rel)
                continue
            dst = os.path.join(out, *rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(full, dst)
            files.append({"path": rel, "size": os.path.getsize(full), "sha256": sha256(full)})

    manifest = {
        "name": man.get("name"),
        "version": man.get("version"),
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "files": files,
    }
    with open(os.path.join(out, "ext-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    new = {x["path"]: x["sha256"] for x in files}
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(p for p in new if p in old and old[p] != new[p])
    print("Extension version:", manifest["version"], "| files published:", len(files),
          "| total %.1f MB" % (sum(x["size"] for x in files) / 1e6))
    if old:
        print("added:", added or "-"); print("changed:", changed or "-")
        print("removed from list (users keep their local copy):", removed or "-")
    if skipped:
        print("vendor files skipped (use --include-vendor to publish):", len(skipped))
    if not old or changed or added:
        print("Tip: bump \"version\" in manifest.json so users can see which version they have.")
    print("Next:  git add .  &&  git commit -m \"ext v%s\"  &&  git push" % manifest["version"])


if __name__ == "__main__":
    main()
