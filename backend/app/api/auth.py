import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.security import create_access_token, current_user, verify_password
from app.models import User
from app.schemas.api import HealthOut, LoginRequest, TokenResponse, UserOut

router = APIRouter(tags=["auth"])

# Simple guard against password guessing: per email and per client address, in this API process.
MAX_FAILED_LOGINS = 5  # per email
MAX_FAILED_LOGINS_PER_CLIENT = 20  # per address; higher because people may share one office address
FAILED_LOGIN_WINDOW_SECONDS = 15 * 60
failed_logins: dict[str, deque] = defaultdict(deque)


def recent_failures(key: str, now: float) -> deque:
    attempts = failed_logins[key]
    while attempts and attempts[0] <= now - FAILED_LOGIN_WINDOW_SECONDS:
        attempts.popleft()
    return attempts


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    email = body.email.strip().lower()
    keys = [f"email:{email}", f"client:{request.client.host if request.client else 'unknown'}"]
    now = time.monotonic()
    limits = (MAX_FAILED_LOGINS, MAX_FAILED_LOGINS_PER_CLIENT)
    if any(len(recent_failures(key, now)) >= limit for key, limit in zip(keys, limits, strict=True)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed logins. Try again later.")
    user = await session.scalar(select(User).where(func.lower(User.email) == email))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        for key in keys:
            failed_logins[key].append(now)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    failed_logins.pop(keys[0], None)
    await write_audit(session, user, "login", "user", user.id)
    await session.commit()
    return TokenResponse(
        access_token=create_access_token(user.id, user.role), user=UserOut.model_validate(user)
    )


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    return user


@router.get("/health", response_model=HealthOut)
async def health(session: AsyncSession = Depends(get_session)) -> HealthOut:
    try:
        await session.execute(text("SELECT 1"))
        database_ok = True
    except Exception:
        database_ok = False
    return HealthOut(
        status="ok" if database_ok else "degraded", database=database_ok, app_mode=settings.app_mode
    )
