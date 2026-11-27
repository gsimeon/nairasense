import re
from datetime import datetime
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
    r"(?:from|sender)\s*[:\-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:to|recipient|beneficiary|ref|reference|date|amt|amount|status)\s*:|\b(?:failed\s+due\s+to|declined\s+due\s+to|due\s+to|was\s+(?:failed|declined|pending|reversed|successful)|transaction\s+(?:failed|declined|pending|reversed|successful))\b|$))",
    re.IGNORECASE,
)
_TO_PATTERN = re.compile(
    r"(?:to|recipient|beneficiary)\s*[:\-]?\s*(.+?)(?=\s*(?:\.\s+|\r|\n|\||;|\b(?:from|sender|ref|reference|date|amt|amount|status)\s*:|\b(?:failed\s+due\s+to|declined\s+due\s+to|due\s+to|was\s+(?:failed|declined|pending|reversed|successful)|transaction\s+(?:failed|declined|pending|reversed|successful))\b|$))",
    re.IGNORECASE,
)
_DATE_PATTERN = re.compile(
    r"(?:(?<=^)|(?<=[\s:(]))(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}/\d{2}/\d{4}|\d{2}-\d{2}-\d{4})(?=\s|$|[.,;)])"
)


def _clean_label(raw: str | None) -> str | None:
    if not raw:
        return None
    # Stop at common field delimiters or newlines
    cleaned = re.split(r"[\r\n|;]+", raw)[0].strip(" .,-:")
    return cleaned or None


def _validate_date_token(token: str | None) -> str | None:
    if not token:
        return None
    parts = re.split(r"[T ]", token, maxsplit=1)
    date_part = parts[0]
    time_part = parts[1] if len(parts) > 1 else None
    if time_part is not None:
        t_match = re.match(
            r"^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|([+-])(\d{2}):(\d{2}))?$",
            time_part,
        )
        if not t_match:
            return None
        hh, mm = int(t_match.group(1)), int(t_match.group(2))
        ss = int(t_match.group(3)) if t_match.group(3) is not None else 0
        if hh > 23 or mm > 59 or ss > 59:
            return None
        if t_match.group(5) is not None:
            tz_hh, tz_mm = int(t_match.group(6)), int(t_match.group(7))
            if tz_hh > 14 or tz_mm > 59 or (tz_hh == 14 and tz_mm != 0):
                return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            datetime.strptime(date_part, fmt)
            return token
        except ValueError:
            continue
    return None


def _is_ambiguous_date(token: str | None) -> bool:
    if not token:
        return False
    date_part = re.split(r"[T ]", token, maxsplit=1)[0]
    match = re.match(r"^(\d{2})[/-](\d{2})/\d{4}$|^(\d{2})-(\d{2})-\d{4}$", date_part)
    if not match:
        return False
    first = int(match.group(1) or match.group(3))
    second = int(match.group(2) or match.group(4))
    return first <= 12 and second <= 12 and first != second


def _classify_amount_context(raw_text: str, start_idx: int) -> str:
    prefix = raw_text[max(0, start_idx - 40) : start_idx].lower()
    if re.search(r"\b(?:avail(?:able)?\s*bal(?:ance)?)\b", prefix):
        return "Available Balance"
    if re.search(r"\b(?:new\s+balance|current\s+balance|balance|bal)\b", prefix):
        return "Balance"
    if re.search(r"\b(?:fee|charge|vat|commission)\b", prefix):
        return "Fee"
    if re.search(r"\brefund\b", prefix):
        return "Refund"
    if re.search(r"\b(?:amt|amount|debit|debited|credit|credited|transfer|purchase)\b", prefix):
        return "Amount"
    return "Other"


def extract_transaction_fields(raw_text: str) -> dict[str, Any]:
    """Deterministically extract candidate transaction fields from pasted alert/receipt text.

    This is a heuristic text parser for user review; it does not verify bank settlement.
    """
    amount_kobo: int | None = None
    candidate_amounts_ngn: list[str] = []
    amount_contexts: dict[str, str] = {}
    for amt_match in _AMOUNT_PATTERN.finditer(raw_text):
        cleaned_num = amt_match.group(1).replace(",", "")
        if cleaned_num not in candidate_amounts_ngn:
            candidate_amounts_ngn.append(cleaned_num)
        if cleaned_num not in amount_contexts:
            amount_contexts[cleaned_num] = _classify_amount_context(raw_text, amt_match.start())

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
    transaction_date = _validate_date_token(date_match.group(1) if date_match else None)

    lowered = raw_text.lower()

    matched_directions: list[str] = []
    for keyword, label in (
        ("credit", "Credit"),
        ("credited", "Credit"),
        ("debit", "Debit"),
        ("debited", "Debit"),
    ):
        if re.search(rf"\b{keyword}\b", lowered) and label not in matched_directions:
            matched_directions.append(label)

    if len(matched_directions) > 1:
        transaction_direction: str | None = "Ambiguous"
    else:
        transaction_direction = matched_directions[0] if matched_directions else None

    outcome_text = re.sub(
        r"\b(?:not\s+(?:successful|success|approved|completed)|unsuccessful)\b",
        " failed ",
        lowered,
    )
    if sender_label:
        outcome_text = outcome_text.replace(sender_label.lower(), " ")
    if recipient_label:
        outcome_text = outcome_text.replace(recipient_label.lower(), " ")
    outcome_text = re.sub(r"\bnot\s+(?:reversed|reversal)\b", " not_reversed ", outcome_text)
    outcome_text = re.sub(r"\bnot\s+(?:failed|declined)\b", " not_failed ", outcome_text)
    outcome_statuses: list[str] = []
    for keyword, label in (
        ("reversed", "Reversed"),
        ("reversal", "Reversed"),
        ("failed", "Failed"),
        ("declined", "Failed"),
        ("pending", "Pending"),
        ("successful", "Successful"),
        ("success", "Successful"),
        ("approved", "Successful"),
        ("completed", "Successful"),
    ):
        if re.search(rf"\b{keyword}\b", outcome_text) and label not in outcome_statuses:
            outcome_statuses.append(label)

    ambiguous_status = len(outcome_statuses) > 1
    if ambiguous_status:
        reported_status = "Ambiguous (Review Required)"
    else:
        reported_status = outcome_statuses[0] if outcome_statuses else None

    return {
        "amount_kobo": amount_kobo,
        "transaction_date": transaction_date,
        "reference": reference,
        "sender_label": sender_label,
        "recipient_label": recipient_label,
        "reported_status": reported_status,
        "extracted_fields": {
            "parser": "deterministic-regex-v2",
            "matched_amount_token": amount_match.group(0) if amount_match else None,
            "multiple_amounts_detected": len(candidate_amounts_ngn) > 1,
            "candidate_amounts_ngn": candidate_amounts_ngn,
            "amount_contexts": amount_contexts,
            "transaction_direction": transaction_direction,
            "ambiguous_status_detected": ambiguous_status,
            "ambiguous_date_detected": _is_ambiguous_date(transaction_date),
            "candidate_statuses": outcome_statuses,
        },
    }
