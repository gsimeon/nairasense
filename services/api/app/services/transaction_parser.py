import re
from decimal import Decimal, InvalidOperation
from typing import Any

_AMOUNT_PATTERN = re.compile(
    r"(?:NGN|₦|N)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)
_REF_PATTERN = re.compile(
    r"(?:ref(?:erence)?|txn\s*id|session\s*id|trans(?:action)?\s*id)\s*[:#-]?\s*([A-Za-z0-9_-]{4,64})",
    re.IGNORECASE,
)
_FROM_PATTERN = re.compile(
    r"(?:from|sender)\s*[:\-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:to|recipient|beneficiary|ref|reference|date|amt|amount|status)\s*:|$))",
    re.IGNORECASE,
)
_TO_PATTERN = re.compile(
    r"(?:to|recipient|beneficiary)\s*[:\-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:from|sender|ref|reference|date|amt|amount|status)\s*:|$))",
    re.IGNORECASE,
)
_DATE_PATTERN = re.compile(
    r"(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?|\d{2}/\d{2}/\d{4}|\d{2}-\d{2}-\d{4})"
)


def _clean_label(raw: str | None) -> str | None:
    if not raw:
        return None
    # Stop at common field delimiters or newlines
    cleaned = re.split(r"[\r\n|;]+", raw)[0].strip(" .,-:")
    return cleaned or None


def extract_transaction_fields(raw_text: str) -> dict[str, Any]:
    """Deterministically extract candidate transaction fields from pasted alert/receipt text.

    This is a heuristic text parser for user review; it does not verify bank settlement.
    """
    amount_kobo: int | None = None
    amount_match = _AMOUNT_PATTERN.search(raw_text)
    if amount_match:
        numeric_str = amount_match.group(1).replace(",", "")
        try:
            amount_kobo = int((Decimal(numeric_str) * 100).to_integral_value())
        except (InvalidOperation, ValueError):
            amount_kobo = None

    ref_match = _REF_PATTERN.search(raw_text)
    reference = ref_match.group(1).strip() if ref_match else None

    from_match = _FROM_PATTERN.search(raw_text)
    sender_label = _clean_label(from_match.group(1)) if from_match else None

    to_match = _TO_PATTERN.search(raw_text)
    recipient_label = _clean_label(to_match.group(1)) if to_match else None

    date_match = _DATE_PATTERN.search(raw_text)
    transaction_date = date_match.group(1) if date_match else None

    lowered = raw_text.lower()
    reported_status: str | None = None
    for keyword, label in (
        ("credit", "Credit"),
        ("credited", "Credit"),
        ("debit", "Debit"),
        ("debited", "Debit"),
        ("successful", "Successful"),
        ("success", "Successful"),
        ("pending", "Pending"),
        ("failed", "Failed"),
        ("reversed", "Reversed"),
    ):
        if re.search(rf"\b{keyword}\b", lowered):
            reported_status = label
            break

    return {
        "amount_kobo": amount_kobo,
        "transaction_date": transaction_date,
        "reference": reference,
        "sender_label": sender_label,
        "recipient_label": recipient_label,
        "reported_status": reported_status,
        "extracted_fields": {
            "parser": "deterministic-regex-v1",
            "matched_amount_token": amount_match.group(0) if amount_match else None,
        },
    }
