"""FastAPI app. Every module in app/api/ that defines `router` is included automatically under /api."""

import importlib
import logging
import pkgutil
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.api as api_package
from app.core.config import settings
from app.core.logging import setup_logging
from app.messaging import get_broker

logger = logging.getLogger(__name__)


def discover_routers() -> list[tuple[str, APIRouter]]:
    routers = []
    for module_info in sorted(pkgutil.iter_modules(api_package.__path__), key=lambda info: info.name):
        if module_info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{api_package.__name__}.{module_info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            routers.append((module_info.name, router))
    return routers


@asynccontextmanager
async def lifespan(application: FastAPI):
    setup_logging()
    yield
    await get_broker().close()


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module_name, router in discover_routers():
        application.include_router(router, prefix="/api")
        logger.debug("Included router from app.api.%s", module_name)
    return application


app = create_app()
