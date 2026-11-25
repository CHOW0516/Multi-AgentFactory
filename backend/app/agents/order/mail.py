"""Poll the configured IMAP folder without setting Seen until intake succeeds."""

import asyncio
import hashlib
import imaplib
import logging
from email import policy
from email.parser import BytesParser

from app.agents.order.events import flush_events
from app.agents.order.intake import (
    DOCUMENT_TYPES,
    MAX_DOCUMENT_BYTES,
    Attachment,
    EmailMetadata,
    store_documents,
)
from app.core.config import settings

logger = logging.getLogger(__name__)


def message_parts(raw: bytes) -> tuple[EmailMetadata, list[Attachment]]:
    message = BytesParser(policy=policy.default).parsebytes(raw)
    message_id = str(message.get("Message-ID", "")).strip()
    if not message_id or len(message_id) > 300:
        message_id = f"sha256:{hashlib.sha256(message_id.encode() if message_id else raw).hexdigest()}"
    body_part = message.get_body(preferencelist=("plain",))
    body = body_part.get_content() if body_part is not None else ""
    attachments = []
    has_attachment = False
    for part in message.walk():
        filename = part.get_filename()
        if not filename or part.is_multipart():
            continue
        has_attachment = True
        attachment = Attachment(filename, part.get_payload(decode=True) or b"")
        if attachment.suffix in DOCUMENT_TYPES and 0 < len(attachment.content) <= MAX_DOCUMENT_BYTES:
            attachments.append(attachment)
        else:
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
    return metadata, attachments


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
                metadata, attachments = message_parts(raw)
                await store_documents(attachments, email=metadata)
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
