"""The "needs attention" list shown on the dashboard. Read-only, no AI calls."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import require_roles
from app.orchestrator.attention import attention_items
from app.schemas.api import AttentionItem

router = APIRouter(tags=["dashboard"])


@router.get("/attention", response_model=list[AttentionItem])
async def attention(
    session: AsyncSession = Depends(get_session), user=Depends(require_roles("manager", "planner"))
):
    return await attention_items(session)
