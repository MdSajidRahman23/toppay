"""Quality Indicators = the OFFICIAL list of return and reject reasons (from Quality_Indicators.xlsx, Nov 2026).
Every indicator points to a template id (tid). Most reuse an existing, proven BP message; the gaps get a new built-in template
(ids qi.NN, added to the library by merge() below). Texts stay editable by the admin like any other template.
Reject texts are English. Placeholders like {g_age_min} follow the admin-edited policy (policy.py).
Order and numbering are EXACTLY as in the sheet (Guarantor has no number 6 in the sheet - kept as is).
"""

# new built-in templates: id -> (section, text)
NEW = {
    # ---- return
    "qi.01": ("guarantor", "জামিনদারের বয়স {g_age_min}–{g_age_max} বছরের মধ্যে নয়। অনুগ্রহ করে জামিনদার পরিবর্তন করুন।"),
    "qi.02": ("address", "কাস্টমারের অন্য লোন অ্যাপ/ইনস্টলমেন্টের প্রমাণ দিতে হবে। যে নম্বর দিয়ে TopPay-তে আবেদন করেছেন সেই নম্বর দিয়ে ওই অ্যাপে login করে (১) Login interface ও (২) Paid off & Unpaid হিস্ট্রির স্ক্রিনশট জমা দিন। স্ক্রিনশটে নাম, নম্বর ও লেনদেনের বিবরণ থাকতে হবে।"),
    "qi.03": ("address", "কাস্টমারের Live photo স্পষ্ট নয়। মুখ পরিষ্কার দেখা যায় এমন আলোতে BP-এর সাথে নতুন ছবি তুলে Onsite photos অপশনে সাবমিট করুন।"),
    # ---- used by the browser extension's automatic checks (not part of the official sheet)
    "qi.25": ("nid", "কাস্টমারের NID কার্ডের ছবির নম্বরের সাথে সিস্টেমে দেওয়া NID নম্বরের মিল নেই। সঠিক NID নম্বর দিন এবং NID কার্ডের স্পষ্ট ছবি জমা দিন।"),
    "qi.26": ("contact", "কাস্টমার, জামিনদার, ফ্যামিলি ও কলিগের ফোন নম্বর আলাদা আলাদা হতে হবে। একই নম্বর একাধিক জায়গায় দেওয়া যাবে না — সঠিক নম্বর দিয়ে রিসাবমিট করুন।"),
    "qi.27": ("contact", "ফ্যামিলি ফোন নম্বর দেওয়া হয়নি। অনুগ্রহ করে কাস্টমারের ফ্যামিলি ফোন নম্বর সাবমিট করুন।"),
    # ---- reject (English)
    "qi.04": ("reject", "Customer is suspected of fraud. The front and back sides of the customer's NID card do not match."),
    "qi.05": ("reject", "Customer is suspected of fraud. The customer's NID card has no signature/fingerprint."),
    "qi.06": ("reject", "Guarantor is suspected of fraud. Someone else is pretending to be the guarantor."),
    "qi.07": ("reject", "Guarantor is suspected of fraud. A voice changer was used during the call."),
    "qi.08": ("reject", "The guarantor does not have the relationship with the customer that was declared."),
    "qi.09": ("reject", "Guarantor is suspected of fraud. The guarantor's video does not match the NID photo."),
    "qi.10": ("reject", "The guarantor is advising the customer against taking the loan."),
    "qi.11": ("reject", "Statement is suspected to be fake. The created date and the modified date of the PDF do not match."),
    "qi.12": ("reject", "Customer is suspected of fraud. The submitted statement belongs to someone else."),
    "qi.13": ("reject", "Customer is suspected of fraud. The account on the statement does not exist."),
    "qi.14": ("reject", "Statement is suspected to be fake. A fake seal/signature was found on the statement."),
    "qi.15": ("reject", "The customer has an existing overdue loan on another platform."),
    "qi.16": ("reject", "The customer has remaining installments on a previous phone loan."),
    "qi.17": ("reject", "Customer is suspected of fraud. The loan screenshot has been edited."),
    "qi.18": ("reject", "The customer is overage. The allowed age is {c_age_min}-{c_age_max}."),
    "qi.19": ("reject", "The customer is underage. The allowed age is {c_age_min}-{c_age_max}."),
    "qi.20": ("reject", "The customer works in a defense/media related profession - not served."),
    "qi.21": ("reject", "The customer lives abroad / is an expatriate - not served."),
    "qi.22": ("reject", "The customer is disabled - not served."),
    "qi.23": ("reject", "Customer is suspected of fraud. A fake marriage certificate / birth certificate was submitted."),
    "qi.24": ("reject", "The customer was rude/abusive during the verification call."),
}

# kind -> [(category, [(number as in the sheet, label as in the sheet, template id)])]
INDICATORS = {
    "return": [
        ("Statement Issue", [
            (1, "Insufficient transaction", "stm.24"),
            (2, "Mini/summary statement is provided", "stm.09"),
            (3, "Statement is not password protected", "stm.20"),
            (4, "Statement doesn't open", "stm.10"),
            (5, "Statement not in customer's/guarantor's name", "stm.29"),
            (6, "Statement in parent's/sibling's name – That person must be listed as the guarantor.", "stm.30"),
            (7, "Statement in business/company name – Submit valid trade license.", "biz.01"),
        ]),
        ("Guarantor Issue", [
            (1, "Guarantor age invalid", "qi.01"),
            (2, "Guarantor is not \"first blood\" relation", "gua.05"),
            (3, "Guarantor's parents' name mismatch", "gua.07"),
            (4, "Guarantor unreachable", "con.09"),
            (5, "Guarantor NID unclear & missing side", "nid.16"),
            (7, "Guarantor not willing to take responsibility", "gua.08"),
            (8, "Guarantor Underage", "gua.03"),
        ]),
        ("NID Issue", [
            (1, "NID not original", "nid.02"),
            (2, "NID cancelled/outdated", "nid.04"),
        ]),
        ("Others", [
            (1, "Other loan app proof needed", "qi.02"),
            (2, "Incomplete address", "adr.19"),
            (3, "IMEI photo missing", "adr.08"),
            (4, "BP + customer photo missing", "adr.06"),
            (5, "Live photo unclear", "qi.03"),
        ]),
    ],
    "reject": [
        ("NID Card Fraud", [
            (1, "NID is fake/edited", "rej.23"),
            (2, "NID front and back mismatch", "qi.04"),
            (3, "NID is AI-generated", "rej.05"),
            (4, "No signature/fingerprint on NID", "qi.05"),
            (5, "NID doesn't exist in system", "rej.09"),
            (6, "Live photo doesn't match NID photo", "rej.15"),
        ]),
        ("Guarantor Fraud", [
            (1, "Someone else pretending to be guarantor", "qi.06"),
            (2, "Voice changer used", "qi.07"),
            (3, "Guarantor doesn't relationship", "qi.08"),
            (4, "Guarantor video doesn't match NID", "qi.09"),
            (5, "The guarantor is advising the customer against taking the loan.", "qi.10"),
        ]),
        ("Statement Fraud", [
            (1, "Statement is edited/fake", "rej.25"),
            (2, "Created/modified date mismatch", "qi.11"),
            (3, "Statement belongs to someone else", "qi.12"),
            (4, "Account doesn't exist", "qi.13"),
            (5, "Fake seal/signature on statement", "qi.14"),
        ]),
        ("Others", [
            (1, "Existing overdue loan on another platform", "qi.15"),
            (2, "Remaining installments on previous phone loan", "qi.16"),
            (3, "Edited loan screenshot", "qi.17"),
            (4, "Customer is overage", "qi.18"),
            (5, "Customer is underage", "qi.19"),
            (6, "Customer works in a defense/media", "qi.20"),
            (7, "Customer lives abroad / expatriate", "qi.21"),
            (8, "Customer disabled", "qi.22"),
            (9, "Fake marriage certificate / birth certificate", "qi.23"),
            (10, "Customer rude/abusive during verification", "qi.24"),
        ]),
    ],
}


def all_tids():
    return [t for groups in INDICATORS.values() for _, items in groups for _, _, t in items]


def merge(templates: dict, builtin: dict):
    """Add the new built-in templates to the library (idempotent; safe to call on every import)."""
    secs = {s["id"]: s for s in templates["sections"]}
    for tid, (sec, text) in NEW.items():
        if tid in builtin:
            continue
        item = {"id": tid, "text": text, "new": True, "changed": False, "source": "quality-indicators"}
        secs[sec]["items"].append(item)
        builtin[tid] = {"id": tid, "text": text, "source": "quality-indicators", "changed": False, "section": sec,
                        "kind": secs[sec]["kind"], "section_title": secs[sec]["title"]}


def payload():
    """For the API: the grouped lists in sheet order."""
    return {kind: [{"category": c, "items": [{"n": n, "label": l, "tid": t} for n, l, t in items]} for c, items in groups]
            for kind, groups in INDICATORS.items()}
