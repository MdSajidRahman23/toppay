"""LLM -> structured JSON. The LLM only EXTRACTS facts; it never decides."""
import json
import os
import time

from rules_engine import FIELDS, NOT_SERVED

SYSTEM_PROMPT = f"""You extract facts from a TopPay field officer's message (Bengali script, Banglish or English).
Return ONLY a JSON object with exactly these keys (use null when NOT mentioned; never guess):

mrp (number, BDT), customer_age (number), guarantor_age (number),
profession: one of job_holder | student | businessman | rider | house_owner | other | {" | ".join(NOT_SERVED)},
guarantor_profession: same allowed values,
tx_1_month (number: best SINGLE month total, cash in + cash out),
tx_3_month (number: 3-month total), down_payment_pct (number 0-100),
monthly_salary (number), rental_income (number per month),
has_original_nid (bool: customer has original NID), is_nid_edited (bool), is_statement_edited (bool),
name_mismatch (bool: customer name differs from statement name),
guarantor_relation: father | mother | brother | sister | spouse | other_relative | friend | colleague,
spouse_proof: marriage_certificate | child_nid | qr_birth_certificate | none,
call_info_unverifiable (bool), office_phone_number (bool: only an official/office number was given),
outside_address_area (bool), salary_slip_submitted (bool), salary_slip_handwritten (bool: handwritten signature/seal),
submission_datetime (ISO 'YYYY-MM-DDTHH:MM' if an exact time is given, else null),
submission_note: evening | weekend | holiday | business_hours (only if stated),
job_id_status: original | photocopy | none | work_photo | visiting_card,
trade_license_status: valid | expired | none,
has_shop_photos (bool: 2 shop photos with signboard + owner at cash counter),
statement_in_business_name (bool).

Number rules: "18k"=18000, "50 hajar"=50000, "1 lakh"=100000, "55000"=55000.
Words: businessman/dokandar/byabsayi -> businessman; chakri/service/employee -> job_holder;
chhatro/student -> student; rider/delivery -> rider; bari-owner/bhara -> house_owner.
"trade license expired / meyad shesh" -> trade_license_status=expired.
"ID card nai" -> job_id_status=none. If an earlier JSON is provided, keep it and only fill/update
what the new message says. Output JSON only, no commentary."""


def _clean(raw: dict) -> dict:
    return {k: raw.get(k) for k in FIELDS}


def _parse_once(text: str, previous: dict, provider: str, api_key: str, model: str) -> dict:
    user_msg = f"Previous JSON: {json.dumps(previous, ensure_ascii=False)}\n\nNew message: {text}"

    if provider == "Gemini":
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key or os.getenv("GEMINI_API_KEY"))
        resp = client.models.generate_content(
            model=model,
            contents=user_msg,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                temperature=0,
            ),
        )
        raw = json.loads(resp.text)
    else:
        from openai import OpenAI

        client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": SYSTEM_PROMPT},
                      {"role": "user", "content": user_msg}],
        )
        raw = json.loads(resp.choices[0].message.content)
    return _clean(raw)


def _is_transient(err: Exception) -> bool:
    msg = str(err).lower()
    return any(t in msg for t in ("503", "unavailable", "429", "overloaded", "high demand", "timeout", "rate"))


def parse_with_llm(text: str, previous: dict, provider: str, api_key: str, model: str) -> dict:
    """Retry temporary errors (busy server) with backoff; optionally fall back to LLM_FALLBACK_MODEL."""
    models = [model]
    fallback = os.getenv("LLM_FALLBACK_MODEL")
    if fallback and fallback != model:
        models.append(fallback)

    last = None
    for m in models:
        for attempt in range(4):  # waits 1s, 2s, 4s between tries
            try:
                return _parse_once(text, previous, provider, api_key, m)
            except Exception as e:
                last = e
                if not _is_transient(e):
                    raise
                if attempt < 3:
                    time.sleep(2 ** attempt)
    raise last


def merge(old: dict, new: dict) -> dict:
    """New non-null values override old ones; nulls never erase known facts."""
    out = dict(old)
    for k, v in new.items():
        if v is not None:
            out[k] = v
    return out
