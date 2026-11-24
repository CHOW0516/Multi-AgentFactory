from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.security import create_access_token, current_user, verify_password
from app.models import User
from app.schemas.api import HealthOut, LoginRequest, TokenResponse, UserOut

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    user = await session.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
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
