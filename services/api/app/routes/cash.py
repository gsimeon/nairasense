from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.db import DEFAULT_USER_ID, VALID_DENOMINATIONS, get_conn
from app.schemas.cash import (
    CashEntryCreate,
    CashEntryResponse,
    CashInferenceResponse,
    CashSessionCreate,
    CashSessionResponse,
)
from app.services.banknote_classifier import classify_banknote
from app.services.local_vision import enroll_note_sample, get_enrollment_counts
from app.settings import settings

router = APIRouter(prefix="/cash", tags=["cash"])


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _load_session(session_id: str) -> CashSessionResponse:
    with get_conn() as conn:
        session_row = conn.execute(
            "SELECT id, currency, created_at, ended_at FROM cash_sessions WHERE id = ? AND user_id = ?",
            (session_id, DEFAULT_USER_ID),
        ).fetchone()
        if session_row is None:
            raise HTTPException(status_code=404, detail="Cash session not found.")

        entry_rows = conn.execute(
            """
            SELECT id, session_id, predicted_denomination, confirmed_denomination,
                   confidence, confirmation_status, created_at
            FROM cash_entries
            WHERE session_id = ? AND user_id = ?
            ORDER BY created_at ASC
            """,
            (session_id, DEFAULT_USER_ID),
        ).fetchall()

    entries = [
        CashEntryResponse(
            id=row["id"],
            session_id=row["session_id"],
            predicted_denomination=row["predicted_denomination"],
            confirmed_denomination=row["confirmed_denomination"],
            confidence=row["confidence"],
            confirmation_status=row["confirmation_status"],
            created_at=row["created_at"],
        )
        for row in entry_rows
    ]
    confirmed_values = [
        e.confirmed_denomination
        for e in entries
        if e.confirmation_status in ("confirmed", "corrected") and e.confirmed_denomination is not None
    ]
    return CashSessionResponse(
        id=session_row["id"],
        currency=session_row["currency"],
        created_at=session_row["created_at"],
        ended_at=session_row["ended_at"],
        confirmed_total_ngn=sum(confirmed_values),
        confirmed_count=len(confirmed_values),
        entries=entries,
    )


@router.post("/infer", response_model=CashInferenceResponse)
async def infer_banknote(
    image: Annotated[UploadFile, File(...)],
) -> CashInferenceResponse:
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if image.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP image.")

    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds the 8 MB prototype limit.")

    return classify_banknote(content, image.content_type)


@router.get("/enrollments")
def list_enrollments() -> dict[str, object]:
    return {"counts": get_enrollment_counts()}


@router.post("/enroll")
async def enroll_banknote(
    denomination_ngn: Annotated[int, Form(...)],
    image: Annotated[UploadFile, File(...)],
) -> dict[str, object]:
    if not settings.allow_reference_enrollment:
        raise HTTPException(
            status_code=403,
            detail="Automatic banknote enrollment is disabled. Enable opt-in dataset collection explicitly.",
        )
    if denomination_ngn not in VALID_DENOMINATIONS:
        raise HTTPException(status_code=422, detail="Invalid Naira denomination.")
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if image.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP image.")
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    try:
        return enroll_note_sample(content, denomination_ngn)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sessions", response_model=CashSessionResponse, status_code=201)
def create_cash_session(payload: CashSessionCreate | None = None) -> CashSessionResponse:
    session_id = str(uuid4())
    currency = payload.currency if payload else "NGN"
    now = _now_iso()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO cash_sessions (id, user_id, currency, created_at) VALUES (?, ?, ?, ?)",
            (session_id, DEFAULT_USER_ID, currency, now),
        )
    return _load_session(session_id)


@router.get("/sessions/{session_id}", response_model=CashSessionResponse)
def get_cash_session(session_id: str) -> CashSessionResponse:
    return _load_session(session_id)


@router.post("/sessions/{session_id}/entries", response_model=CashEntryResponse, status_code=201)
def add_cash_entry(session_id: str, payload: CashEntryCreate) -> CashEntryResponse:
    with get_conn() as conn:
        session_row = conn.execute(
            "SELECT id FROM cash_sessions WHERE id = ? AND user_id = ?",
            (session_id, DEFAULT_USER_ID),
        ).fetchone()
        if session_row is None:
            raise HTTPException(status_code=404, detail="Cash session not found.")

        entry_id = str(uuid4())
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO cash_entries (
                id, session_id, user_id, predicted_denomination,
                confirmed_denomination, confidence, confirmation_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry_id,
                session_id,
                DEFAULT_USER_ID,
                payload.predicted_denomination,
                payload.confirmed_denomination,
                payload.confidence,
                payload.confirmation_status,
                now,
            ),
        )
    return CashEntryResponse(
        id=entry_id,
        session_id=session_id,
        predicted_denomination=payload.predicted_denomination,
        confirmed_denomination=payload.confirmed_denomination,
        confidence=payload.confidence,
        confirmation_status=payload.confirmation_status,
        created_at=now,
    )


@router.delete("/entries/{entry_id}", status_code=204)
def delete_cash_entry(entry_id: str) -> None:
    with get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM cash_entries WHERE id = ? AND user_id = ?",
            (entry_id, DEFAULT_USER_ID),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Cash entry not found.")
