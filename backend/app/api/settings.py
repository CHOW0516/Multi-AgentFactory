from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.config import EDITABLE_SETTING_KEYS, settings
from app.core.db import get_session
from app.core.security import current_user, require_roles
from app.models import AppSetting, User
from app.schemas.api import SettingsOut, SettingsPatch

router = APIRouter(tags=["settings"])


async def effective_settings(session: AsyncSession) -> dict[str, float]:
    """Env defaults, overridden by rows in app_settings. Agents should read thresholds through this."""
    values = {key: float(getattr(settings, key)) for key in EDITABLE_SETTING_KEYS}
    rows = (await session.scalars(select(AppSetting).where(AppSetting.key.in_(EDITABLE_SETTING_KEYS)))).all()
    for row in rows:
        values[row.key] = float(row.value)
    return values


@router.get("/settings", response_model=SettingsOut)
async def read_settings(
    session: AsyncSession = Depends(get_session), user: User = Depends(current_user)
) -> SettingsOut:
    return SettingsOut(
        app_mode=settings.app_mode,
        currency=settings.currency,
        timezone=settings.app_timezone,
        values=await effective_settings(session),
    )


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(
    body: SettingsPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_roles("admin")),
) -> SettingsOut:
    unknown = set(body.values) - set(EDITABLE_SETTING_KEYS)
    if unknown:
        raise HTTPException(422, f"These settings cannot be edited: {', '.join(sorted(unknown))}")
    before = await effective_settings(session)
    for key, value in body.values.items():
        if value < 0:
            raise HTTPException(422, f"{key} cannot be negative")
        row = await session.scalar(select(AppSetting).where(AppSetting.key == key))
        if row is None:
            session.add(AppSetting(key=key, value=str(value)))
        else:
            row.value = str(value)
    await session.flush()
    after = await effective_settings(session)
    await write_audit(session, user, "update", "settings", None, before, after)
    await session.commit()
    return SettingsOut(
        app_mode=settings.app_mode, currency=settings.currency, timezone=settings.app_timezone, values=after
    )


@router.post("/demo/reset")
async def reset_demo_data(
    session: AsyncSession = Depends(get_session), user: User = Depends(require_roles())
) -> dict[str, int]:
    """Wipes every table and loads the demo data again, like `python -m app.simulator reset`. Admin only, demo mode only.
    Everyone, including the caller, must log in again afterwards because the users are created again."""
    from app.simulator.seed import seed  # imported here so the API does not load the simulator at startup

    if not settings.is_demo:
        raise HTTPException(403, "Demo reset is only available when APP_MODE=demo")
    # End this request's read transaction so TRUNCATE is not blocked by our own lock on the users table.
    await session.rollback()
    return await seed(reset=True)
