import time
from typing import Annotated

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.db import get_conn
from app.settings import settings

_bearer = HTTPBearer(auto_error=False)
_password_hasher = PasswordHasher()


class AuthUser(BaseModel):
    user_id: str
    username: str


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return _password_hasher.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(user_id: str, username: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "username": username,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "exp": now + settings.auth_token_ttl_seconds,
    }
    return jwt.encode(payload, settings.auth_secret, algorithm="HS256")


def decode_access_token(token: str) -> AuthUser:
    try:
        payload = jwt.decode(
            token,
            settings.auth_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
        return AuthUser(user_id=str(payload["sub"]), username=str(payload["username"]))
    except (jwt.PyJWTError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
        ) from exc


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    user = decode_access_token(credentials.credentials)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, username FROM users WHERE id = ?",
            (user.user_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found.",
        )
    return AuthUser(user_id=row["id"], username=row["username"])


def get_optional_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser | None:
    if credentials is None:
        return None
    return get_current_user(credentials)
