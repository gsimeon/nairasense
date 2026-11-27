import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from app.auth import AuthUser, get_current_user
from app.db import get_conn, parse_json_dict
from app.schemas.transactions import (
    TransactionCreate,
    TransactionExtractRequest,
    TransactionExtractResponse,
    TransactionResponse,
    TransactionUpdate,
)
from app.services.transaction_parser import (
    _is_ambiguous_date,
    _validate_date_token,
    extract_transaction_fields,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _row_to_response(row) -> TransactionResponse:
    return TransactionResponse(
        id=row["id"],
        amount_kobo=row["amount_kobo"],
        currency=row["currency"],
        transaction_date=row["transaction_date"],
        reference=row["reference"],
        sender_label=row["sender_label"],
        recipient_label=row["recipient_label"],
        reported_status=row["reported_status"],
        source_type=row["source_type"],
        extracted_fields=parse_json_dict(row["extracted_fields"]),
        user_confirmed=bool(row["user_confirmed"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.post("/extract", response_model=TransactionExtractResponse)
def extract_transaction(payload: TransactionExtractRequest) -> TransactionExtractResponse:
    parsed = extract_transaction_fields(payload.raw_text)
    return TransactionExtractResponse(
        amount_kobo=parsed["amount_kobo"],
        currency="NGN",
        transaction_date=parsed["transaction_date"],
        reference=parsed["reference"],
        sender_label=parsed["sender_label"],
        recipient_label=parsed["recipient_label"],
        reported_status=parsed["reported_status"],
        source_type=payload.source_type,
        extracted_fields=parsed["extracted_fields"],
        requires_user_confirmation=True,
    )


@router.post("", response_model=TransactionResponse, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> TransactionResponse:
    if payload.transaction_date is not None and payload.transaction_date.strip():
        clean_date = payload.transaction_date.strip()
        if _validate_date_token(clean_date) is None:
            raise HTTPException(
                status_code=422,
                detail="Invalid transaction_date; expected a valid calendar date.",
            )
        if (
            payload.user_confirmed
            and (
                _is_ambiguous_date(clean_date)
                or payload.extracted_fields.get("ambiguous_date_detected") is True
            )
            and payload.extracted_fields.get("date_confirmed_by_user") is not True
        ):
            raise HTTPException(
                status_code=422,
                detail="Ambiguous transaction date must be explicitly confirmed or cleared before saving.",
            )

    selected_id = payload.extracted_fields.get("selected_candidate_id")
    if selected_id is not None:
        labeled = payload.extracted_fields.get("labeled_amounts")
        if not isinstance(labeled, list):
            raise HTTPException(
                status_code=422,
                detail="Selected amount candidate ID requires extracted labeled_amounts.",
            )
        matched = next(
            (item for item in labeled if isinstance(item, dict) and item.get("id") == selected_id),
            None,
        )
        if matched is None:
            raise HTTPException(
                status_code=422,
                detail="Selected amount candidate ID was not found in extracted candidates.",
            )
        selected_ctx = payload.extracted_fields.get("selected_candidate_context")
        if selected_ctx is not None and matched.get("context") != selected_ctx:
            raise HTTPException(
                status_code=422,
                detail="Selected amount candidate context does not match extracted candidate.",
            )
        try:
            expected_kobo = int((Decimal(str(matched.get("amount_ngn", ""))) * 100).to_integral_value())
        except (InvalidOperation, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail="Invalid amount in selected candidate.",
            ) from exc
        if payload.amount_kobo != expected_kobo:
            raise HTTPException(
                status_code=422,
                detail="Saved amount does not match the selected candidate amount.",
            )
        payload.extracted_fields.setdefault("amount_entry_mode", "candidate_selected")
    elif payload.amount_kobo is not None:
        payload.extracted_fields.setdefault("amount_entry_mode", "manual")
    else:
        payload.extracted_fields.setdefault("amount_entry_mode", "unknown")

    clean_key = idempotency_key.strip() if idempotency_key else None
    req_hash = (
        hashlib.sha256(
            json.dumps(payload.model_dump(), sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if clean_key
        else None
    )
    tx_id = str(uuid4())
    now = _now_iso()
    with get_conn() as conn:
        if clean_key:
            existing = conn.execute(
                "SELECT * FROM transaction_records WHERE user_id = ? AND idempotency_key = ?",
                (current_user.user_id, clean_key),
            ).fetchone()
            if existing is not None:
                if existing["idempotency_hash"] != req_hash:
                    raise HTTPException(
                        status_code=409,
                        detail="Idempotency-Key reused with a different payload.",
                    )
                return _row_to_response(existing)

        conn.execute(
            """
            INSERT INTO transaction_records (
                id, user_id, amount_kobo, currency, transaction_date, reference,
                sender_label, recipient_label, reported_status, source_type,
                extracted_fields, user_confirmed, idempotency_key, idempotency_hash,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tx_id,
                current_user.user_id,
                payload.amount_kobo,
                payload.currency,
                payload.transaction_date,
                payload.reference,
                payload.sender_label,
                payload.recipient_label,
                payload.reported_status,
                payload.source_type,
                json.dumps(payload.extracted_fields),
                1 if payload.user_confirmed else 0,
                clean_key,
                req_hash,
                now,
                now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM transaction_records WHERE id = ? AND user_id = ?",
            (tx_id, current_user.user_id),
        ).fetchone()
    return _row_to_response(row)


@router.get("", response_model=list[TransactionResponse])
def list_transactions(
    response: Response,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    cursor_created_at: Annotated[str | None, Query()] = None,
    cursor_id: Annotated[str | None, Query()] = None,
) -> list[TransactionResponse]:
    with get_conn() as conn:
        total_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM transaction_records WHERE user_id = ?",
            (current_user.user_id,),
        ).fetchone()
        total = int(total_row["cnt"]) if total_row else 0
        if cursor_created_at and cursor_id:
            rows = conn.execute(
                """
                SELECT * FROM transaction_records
                WHERE user_id = ?
                  AND (created_at < ? OR (created_at = ? AND id < ?))
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (current_user.user_id, cursor_created_at, cursor_created_at, cursor_id, limit),
            ).fetchall()
            has_more = len(rows) == limit
        else:
            rows = conn.execute(
                """
                SELECT * FROM transaction_records
                WHERE user_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (current_user.user_id, limit, offset),
            ).fetchall()
            has_more = (offset + len(rows)) < total
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Has-More"] = "true" if has_more else "false"
    return [_row_to_response(row) for row in rows]


@router.patch("/{tx_id}", response_model=TransactionResponse)
def update_transaction(
    tx_id: str,
    payload: TransactionUpdate,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> TransactionResponse:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update.")

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM transaction_records WHERE id = ? AND user_id = ?",
            (tx_id, current_user.user_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Transaction record not found.")

        if "user_confirmed" in updates:
            updates["user_confirmed"] = 1 if updates["user_confirmed"] else 0
        updates["updated_at"] = _now_iso()

        assignments = ", ".join(f"{col} = ?" for col in updates)
        values = [*list(updates.values()), tx_id, current_user.user_id]
        conn.execute(
            f"UPDATE transaction_records SET {assignments} WHERE id = ? AND user_id = ?",
            values,
        )
        row = conn.execute(
            "SELECT * FROM transaction_records WHERE id = ? AND user_id = ?",
            (tx_id, current_user.user_id),
        ).fetchone()
    return _row_to_response(row)


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(
    tx_id: str,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> None:
    with get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM transaction_records WHERE id = ? AND user_id = ?",
            (tx_id, current_user.user_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Transaction record not found.")
