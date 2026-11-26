"""Share document storage and received-event delivery between IMAP and upload."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parseaddr
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select, text

from app.agents.order.events import flush_events, stage_event
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import session_scope
from app.models import Customer, Order, SourceDocument, User
from app.orchestrator.outbox import notify

logger = logging.getLogger(__name__)
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
DOCUMENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@dataclass(frozen=True)
class Attachment:
    filename: str
    content: bytes

    @property
    def suffix(self) -> str:
        return Path(self.filename).suffix.lower()


# Email attachment with the simulator PO's printed values (JSON); honoured only in demo mode.
DEMO_DATA_FILE = "factory-demo-data.json"
MAX_DEMO_DATA_BYTES = 64 * 1024

# Senders on these domains are matched by full address, never by domain.
PUBLIC_MAIL_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com"}


def address_of(sender: str) -> str:
    return parseaddr(sender)[1].strip().lower()


async def known_sender(session, sender: str) -> bool:
    """A sender is known when the address, or its company domain, matches a customer's email."""
    address = address_of(sender)
    if "@" not in address:
        return False
    domain = address.rsplit("@", 1)[1]
    emails = [email.strip().lower() for email in await session.scalars(select(Customer.email)) if email]
    if address in emails:
        return True
    return domain not in PUBLIC_MAIL_DOMAINS and any(email.endswith("@" + domain) for email in emails)


@dataclass(frozen=True)
class EmailMetadata:
    message_id: str
    sender: str
    subject: str
    body: str
    demo_data: bytes | None = None


def document_path(stored_path: str) -> Path:
    root = Path(settings.document_storage_path).resolve()
    candidate = (root / stored_path).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("Document path is outside document storage")
    return candidate


def write_attachment(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = path.open("xb")
    try:
        with output:
            output.write(content)
    except OSError:
        path.unlink(missing_ok=True)
        raise


async def store_documents(
    attachments: list[Attachment],
    *,
    email: EmailMetadata | None = None,
    user: User | None = None,
) -> list[Order]:
    if not attachments:
        return []
    for attachment in attachments:
        if attachment.suffix not in DOCUMENT_TYPES and (email is None or attachment.suffix != ".txt"):
            raise ValueError(f"Unsupported PO file type: {attachment.suffix}")
        if not attachment.content or len(attachment.content) > MAX_DOCUMENT_BYTES:
            raise ValueError("PO files must be non-empty and no larger than 20 MB")

    orders, created_paths = [], []
    try:
        async with session_scope() as session:
            if email is not None:
                await session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                    {"key": f"order.email:{email.message_id}"},
                )
                orders = list(
                    await session.scalars(
                        select(Order)
                        .join(SourceDocument, SourceDocument.id == Order.source_document_id)
                        .where(SourceDocument.email_message_id == email.message_id)
                        .order_by(SourceDocument.created_at, SourceDocument.id)
                    )
                )
            # Unknown senders are stored but not read by the AI until sales releases them.
            trusted = email is None or await known_sender(session, email.sender)
            if not orders:
                year = datetime.now(UTC).astimezone(ZoneInfo(settings.app_timezone)).year
                for attachment in attachments:
                    document_id, order_id = uuid4(), uuid4()
                    stored_path = f"{document_id.hex}{attachment.suffix}"
                    path = document_path(stored_path)
                    await asyncio.to_thread(write_attachment, path, attachment.content)
                    created_paths.append(path)
                    if email and email.demo_data and settings.is_demo and len(attachments) == 1:
                        sidecar = document_path(f"{stored_path}.demo.json")
                        await asyncio.to_thread(write_attachment, sidecar, email.demo_data)
                        created_paths.append(sidecar)
                    document = SourceDocument(
                        id=document_id,
                        file_path=stored_path,
                        file_name=Path(attachment.filename.replace("\\", "/")).name[:300],
                        mime_type=DOCUMENT_TYPES.get(attachment.suffix, "text/plain"),
                        email_message_id=email.message_id if email else None,
                        email_from=email.sender if email else None,
                        email_subject=email.subject if email else None,
                        email_body=email.body if email else None,
                        uploaded_by=user.id if user else None,
                    )
                    session.add(document)
                    await session.flush()
                    order = Order(
                        id=order_id,
                        order_number=f"SO-{year}-{order_id.hex[:16].upper()}",
                        source_document_id=document_id,
                        status="RECEIVED" if trusted else "SENDER_REVIEW",
                    )
                    session.add(order)
                    orders.append(order)
                    if trusted:
                        await stage_event(
                            session,
                            order_id,
                            "event.order.received",
                            from_agent="order",
                            document_id=document_id,
                        )
                    await write_audit(
                        session,
                        user or "order",
                        "receive",
                        "orders",
                        order_id,
                        None,
                        {"status": order.status, "document_id": str(document_id)},
                    )
                if not trusted:
                    notify(
                        session,
                        list(await session.scalars(select(User).where(User.role == "sales", User.is_active))),
                        "sender_review",
                        f"PO email from an unknown sender: {email.sender[:120]}",
                        "Check it and release it for reading, or cancel it.",
                        "/orders",
                    )
    except Exception:
        for path in created_paths:
            try:
                await asyncio.to_thread(path.unlink, missing_ok=True)
            except OSError:
                logger.exception("Could not clean up an incomplete PO intake file")
        raise

    for order in orders:
        await flush_events(order.id, retry=user is not None)
    return orders
