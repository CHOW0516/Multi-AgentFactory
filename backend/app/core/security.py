"""Password hashing, JWT tokens, and role checks."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.models import User

ROLES = ("manager", "sales", "planner", "store", "qc", "admin")

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(plain_password: str) -> str:
    return password_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return password_context.verify(plain_password, password_hash)


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "role": role, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError when the token is invalid or expired."""
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    token: str | None = Query(default=None, include_in_schema=False),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Reads the JWT from the Authorization header, or from ?token= (for files opened in an iframe)."""
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not logged in", {"WWW-Authenticate": "Bearer"}
    )
    raw_token = credentials.credentials if credentials is not None else token
    if not raw_token:
        raise unauthorized
    try:
        payload = decode_access_token(raw_token)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized from None
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_roles(*allowed_roles: str):
    """Dependency factory. Admin is always allowed."""

    async def check_role(user: User = Depends(current_user)) -> User:
        if user.role != "admin" and user.role not in allowed_roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot do this")
        return user

    return check_role
