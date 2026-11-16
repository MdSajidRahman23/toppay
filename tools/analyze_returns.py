"""Analyse the raw return-reason dump (Return_reason.docx / MemberData.xlsx).

Usage:  python tools/analyze_returns.py <Return_reason.docx|MemberData.xlsx> [more files...]
Writes: tools/out/return_report.md  (frequency report)
        tools/out/candidates.json   (new template candidates, exact wording, PII scrubbed)
Nothing here touches the server; run it only on your own PC.
"""
import collections, difflib, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "api"))

BN = "০১২৩৪৫৬৭৮৯"


def to_en(s):
    return s.translate({ord(b): str(i) for i, b in enumerate(BN)})


def load_rows(path):
    rows = []
    if path.lower().endswith(".docx"):
        import docx
        d = docx.Document(path)
        for t in d.tables:
            rows += [r.cells[0].text for r in t.rows]
        rows += [p.text for p in d.paragraphs if p.text.strip()]
    else:
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True).active
        rows = [str(r[0]) for r in ws.iter_rows(values_only=True) if r and r[0]]
    out = []
    for r in rows:
        r = r.strip()
        if r.startswith("{"):
            try:
                r = json.loads(r).get("result", r)
            except ValueError:
                pass
        out.append(r)
    return out


def scrub(s):
    """Remove customer data: phone numbers, long digit runs, e-mails, URLs-with-ids."""
    s = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", s)
    s = re.sub(r"(?<!\d)(?:\+?88)?0?1[3-9][\d\s-]{8,12}(?!\d)", "[phone]", to_en(s))  # to_en only for matching
    return s


def scrub_keep_bn(s):
    """Scrub on the original text but keep Bangla digits elsewhere."""
    en = to_en(s)
    spans = [m.span() for m in re.finditer(r"(?<!\d)(?:\+?88)?0?1[3-9][\d\s-]{8,12}(?!\d)|\d{10,}", en)]
    for a, b in reversed(spans):
        s = s[:a] + "[number]" + s[b:]
    return re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email]", s)


def segments(row):
    """Split a multi-reason message into single reasons (bullets / new lines); very short lines are glued to the previous one."""
    parts = re.split(r"\r?\n+|(?:^|\s)[*•✦]+\s*|(?:^|\s)-\s+(?=\S)", row)
    segs = []
    for p in parts:
        p = re.sub(r"\s+", " ", p or "").strip(" *-•✦\t")
        if not p:
            continue
        if segs and len(p) < 30:
            segs[-1] += "\n" + p
        else:
            segs.append(p)
    return [x for x in segs if len(x) >= 20]


def norm(s):
    s = unicodedata.normalize("NFD", s)
    return re.sub(r"[\s\*\.,।\-–—()\[\]\"'“”‘’:;!?]+", "", to_en(s)).lower()


CATS = [
    ("PalmPay / other EMI app", ["palmpay", "momo", "sahaj", "ambala", "emi লোন", "লোন অ্যাপ", "installment"]),
    ("Statement (bKash/Nagad/bank)", ["স্টেটমেন্ট", "statement", "bkash", "বিকাশ", "নগদ", "nagad", "লেনদেন"]),
    ("NID", ["nid", "জাতীয় পরিচয়", "এনআইডি", "স্মার্ট কার্ড"]),
    ("Guarantor", ["জামিনদার", "গ্যারান্টর", "গ্যারান্টার", "guarantor"]),
    ("Photo / IMEI / signature", ["ছবি", "imei", "আইএমইআই", "সাইন", "সিগনেচার", "photo"]),
    ("Address", ["ঠিকানা", "address"]),
    ("Job / business / trade licence", ["ট্রেড লাইসেন্স", "জব", "চাকরি", "সাইনবোর্ড", "স্যালারি", "ক্যাশ মেমো", "ব্যবসা"]),
    ("Contact / phone", ["কল করা", "ফোন", "মোবাইল নাম্বার", "নম্বর", "যোগাযোগ", "কলিগ", "সহকর্মী"]),
    ("Video request", ["ভিডিও"]),
    ("Reject / fraud", ["reject", "রিজেক্ট", "fraud", "fake"]),
]


def category(s):
    low = s.lower()
    for name, kws in CATS:
        if any(k in low for k in kws):
            return name
    return "Other"


def builtin_texts():
    import templates_data
    out = []
    for sec in templates_data.TEMPLATES["sections"]:
        for it in sec["items"]:
            out.append((it["id"], norm(it["text"])))
    return out


def main(paths):
    # several files may hold the same dump: a row counts as often as the file that has it most often
    best = collections.Counter()
    for p in paths:
        c = collections.Counter(load_rows(p))
        for k, v in c.items():
            best[k] = max(best[k], v)
    raw = [k for k, v in best.items() for _ in range(v)]
    total = len(raw)
    row_counter = collections.Counter(norm(r) for r in raw)
    dup_rows = sum(1 for v in row_counter.values() if v > 1)
    seg_counter, seg_example = collections.Counter(), {}
    for r in raw:
        for s in set(segments(r)):
            k = norm(scrub_keep_bn(s))
            if not k:
                continue
            seg_counter[k] += 1
            seg_example.setdefault(k, scrub_keep_bn(s))
    built = builtin_texts()
    rows_out, cand = [], []
    for k, n in seg_counter.most_common():
        ex = seg_example[k]
        best = max(((difflib.SequenceMatcher(None, k, b).ratio(), tid) for tid, b in built), default=(0, None))
        covered = best[0] >= 0.82
        rows_out.append((n, category(ex), ex, best[1] if covered else None))
        if not covered and n >= 2:
            cand.append({"count": n, "category": category(ex), "text": ex})
    cats = collections.Counter()
    for n, c, _, _ in rows_out:
        cats[c] += n
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    with open(os.path.join(HERE, "out", "candidates.json"), "w", encoding="utf-8") as f:
        json.dump(cand, f, ensure_ascii=False, indent=1)
    L = [f"# Return reason frequency report\n",
         f"- Raw rows: **{total}**; unique rows after normalising: **{len(row_counter)}**; row-groups that were duplicated: **{dup_rows}**",
         f"- Distinct single reasons (after splitting multi-reason rows): **{len(seg_counter)}**",
         f"- Already covered by a built-in template (>=82% similar): **{sum(1 for r in rows_out if r[3])}**",
         f"- New candidates seen at least twice: **{len(cand)}**\n",
         "## Reasons per category (counting every mention)\n", "| Category | Mentions |", "|---|---|"]
    L += [f"| {c} | {n} |" for c, n in cats.most_common()]
    L += ["\n## Top 40 single reasons\n", "| # | Count | Category | Built-in match | Text |", "|---|---|---|---|---|"]
    for i, (n, c, ex, tid) in enumerate(rows_out[:40], 1):
        L.append(f"| {i} | {n} | {c} | {tid or '— new —'} | {ex[:140].replace('|', '/')} |")
    open(os.path.join(HERE, "out", "return_report.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("\n".join(L[:14]))


if __name__ == "__main__":
    main(sys.argv[1:]) if len(sys.argv) > 1 else print(__doc__)
