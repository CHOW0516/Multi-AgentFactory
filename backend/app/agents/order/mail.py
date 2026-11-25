"""Poll the configured IMAP folder without setting Seen until intake succeeds."""

import asyncio
import hashlib
import imaplib
import logging
from email import policy
from email.parser import BytesParser

from sqlalchemy import select

from app.agents.order.events import flush_events
from app.agents.order.intake import (
    DOCUMENT_TYPES,
    MAX_DOCUMENT_BYTES,
    Attachment,
    EmailMetadata,
    store_documents,
)
from app.core.config import settings
from app.core.db import session_scope
from app.models import User
from app.orchestrator.outbox import notify

logger = logging.getLogger(__name__)
# Images this small are logos and signatures, not scanned POs.
MIN_IMAGE_BYTES = 20 * 1024


def is_decoration(part, attachment: Attachment) -> bool:
    """Embedded logos (with a Content-ID) and tiny images would each become a junk order and an AI call."""
    if not attachment.suffix or DOCUMENT_TYPES.get(attachment.suffix, "").split("/")[0] != "image":
        return False
    return part.get("Content-ID") is not None or len(attachment.content) < MIN_IMAGE_BYTES


def message_parts(raw: bytes) -> tuple[EmailMetadata, list[Attachment], list[str]]:
    """Returns the email, the attachments to read, and the names of attachments that were skipped."""
    message = BytesParser(policy=policy.default).parsebytes(raw)
    message_id = str(message.get("Message-ID", "")).strip()
    if not message_id or len(message_id) > 300:
        message_id = f"sha256:{hashlib.sha256(message_id.encode() if message_id else raw).hexdigest()}"
    body_part = message.get_body(preferencelist=("plain",))
    body = body_part.get_content() if body_part is not None else ""
    attachments, skipped = [], []
    has_attachment = False
    for part in message.walk():
        filename = part.get_filename()
        if not filename or part.is_multipart():
            continue
        has_attachment = True
        attachment = Attachment(filename, part.get_payload(decode=True) or b"")
        if is_decoration(part, attachment):
            continue
        if attachment.suffix in DOCUMENT_TYPES and 0 < len(attachment.content) <= MAX_DOCUMENT_BYTES:
            attachments.append(attachment)
        else:
            skipped.append(attachment.filename[:120])
            logger.info("Skipped an unsupported, empty, or oversized attachment on message %s", message_id)
    if not has_attachment and isinstance(body, str) and body.strip():
        content = body.encode("utf-8")
        if len(content) <= MAX_DOCUMENT_BYTES:
            attachments.append(Attachment("email-body.txt", content))
    metadata = EmailMetadata(
        message_id,
        str(message.get("From", ""))[:300],
        str(message.get("Subject", ""))[:500],
        body if isinstance(body, str) else "",
    )
    return metadata, attachments, skipped


async def report_skipped(metadata: EmailMetadata, skipped: list[str]) -> None:
    """A PO in a format we cannot read must not disappear silently: tell sales."""
    async with session_scope() as session:
        sales = list(await session.scalars(select(User).where(User.role == "sales", User.is_active)))
        notify(
            session,
            sales,
            "email_skipped",
            f"Could not read a PO email from {metadata.sender[:120]}",
            f"Subject: {metadata.subject[:200]}. Files not read: {', '.join(skipped)}. "
            "Ask the customer for PDF, image, Word (.docx) or Excel (.xlsx), or upload it by hand.",
            "/orders",
        )


def open_mailbox():
    connection_type = imaplib.IMAP4_SSL if settings.imap_use_ssl else imaplib.IMAP4
    connection = connection_type(settings.imap_host, settings.imap_port, timeout=30)
    try:
        connection.login(settings.imap_user, settings.imap_password)
        status, _ = connection.select(settings.imap_folder)
        if status != "OK":
            raise RuntimeError(f"Could not select {settings.imap_folder}")
    except Exception:
        connection.logout()
        raise
    return connection


async def poll_once() -> None:
    connection = await asyncio.to_thread(open_mailbox)
    try:
        status, response = await asyncio.to_thread(connection.uid, "SEARCH", None, "UNSEEN")
        if status != "OK":
            raise RuntimeError("IMAP search failed")
        for uid in response[0].split():
            try:
                status, response = await asyncio.to_thread(connection.uid, "FETCH", uid, "(BODY.PEEK[])")
                raw = next((entry[1] for entry in response if isinstance(entry, tuple)), None)
                if status != "OK" or not isinstance(raw, bytes):
                    raise RuntimeError("IMAP fetch failed")
                metadata, attachments, skipped = message_parts(raw)
                await store_documents(attachments, email=metadata)
                if skipped:
                    await report_skipped(metadata, skipped)
                status, _ = await asyncio.to_thread(connection.uid, "STORE", uid, "+FLAGS.SILENT", "(\\Seen)")
                if status != "OK":
                    raise RuntimeError("IMAP could not mark the message seen")
            except Exception:
                logger.exception("Order intake failed for IMAP UID %r", uid)
    finally:
        await asyncio.to_thread(connection.logout)


async def poll_periodically() -> None:
    while True:
        try:
            await flush_events(retry=True)
        except Exception:
            logger.exception("Could not load pending order events")
        try:
            await poll_once()
        except Exception:
            logger.exception("Could not poll the orders mailbox")
        await asyncio.sleep(settings.email_poll_seconds)
