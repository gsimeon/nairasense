from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import (
    AuthUser,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.db import get_conn
from app.rate_limit import rate_limit_auth
from app.schemas.auth import AuthCredentials, AuthTokenResponse, AuthUserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_auth)],
)
def register(payload: AuthCredentials) -> AuthTokenResponse:
    username = payload.username.strip().lower()
    user_id = str(uuid4())
    now = datetime.now(UTC).isoformat()
    password_hash = hash_password(payload.password)

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username is already registered.",
            )
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, username, password_hash, now),
        )

    token = create_access_token(user_id=user_id, username=username)
    return AuthTokenResponse(access_token=token, user_id=user_id, username=username)


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    dependencies=[Depends(rate_limit_auth)],
)
def login(payload: AuthCredentials) -> AuthTokenResponse:
    username = payload.username.strip().lower()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if row is None or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    token = create_access_token(user_id=row["id"], username=row["username"])
    return AuthTokenResponse(access_token=token, user_id=row["id"], username=row["username"])


@router.get("/me", response_model=AuthUserResponse)
def me(current_user: Annotated[AuthUser, Depends(get_current_user)]) -> AuthUserResponse:
    return AuthUserResponse(user_id=current_user.user_id, username=current_user.username)
