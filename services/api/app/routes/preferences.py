from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import AuthUser, get_current_user
from app.db import get_conn
from app.schemas.preferences import UserPreferences, UserPreferencesResponse

router = APIRouter(prefix="/preferences", tags=["preferences"])


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


@router.get("", response_model=UserPreferencesResponse)
def get_preferences(
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> UserPreferencesResponse:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT text_size, high_contrast, speech_enabled, speech_rate, updated_at "
            "FROM user_preferences WHERE user_id = ?",
            (current_user.user_id,),
        ).fetchone()
        if row is None:
            now = _now_iso()
            conn.execute(
                """
                INSERT INTO user_preferences (user_id, text_size, high_contrast, speech_enabled, speech_rate, updated_at)
                VALUES (?, 'large', 0, 1, 1.0, ?)
                """,
                (current_user.user_id, now),
            )
            return UserPreferencesResponse(
                text_size="large",
                high_contrast=False,
                speech_enabled=True,
                speech_rate=1.0,
                updated_at=now,
            )
    return UserPreferencesResponse(
        text_size=row["text_size"],
        high_contrast=bool(row["high_contrast"]),
        speech_enabled=bool(row["speech_enabled"]),
        speech_rate=float(row["speech_rate"]),
        updated_at=row["updated_at"],
    )


@router.put("", response_model=UserPreferencesResponse)
def update_preferences(
    payload: UserPreferences,
    current_user: Annotated[AuthUser, Depends(get_current_user)],
) -> UserPreferencesResponse:
    now = _now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_preferences (user_id, text_size, high_contrast, speech_enabled, speech_rate, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                text_size = excluded.text_size,
                high_contrast = excluded.high_contrast,
                speech_enabled = excluded.speech_enabled,
                speech_rate = excluded.speech_rate,
                updated_at = excluded.updated_at
            """,
            (
                current_user.user_id,
                payload.text_size,
                1 if payload.high_contrast else 0,
                1 if payload.speech_enabled else 0,
                payload.speech_rate,
                now,
            ),
        )
    return UserPreferencesResponse(
        text_size=payload.text_size,
        high_contrast=payload.high_contrast,
        speech_enabled=payload.speech_enabled,
        speech_rate=payload.speech_rate,
        updated_at=now,
    )
