"""Validation and safe delivery for media stored with a chat message."""

import base64
import binascii

from fastapi import HTTPException
from fastapi.responses import Response

from models.hr import MessageAttachment, MessageAttachmentUpload

MAX_MESSAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024
ALLOWED_MESSAGE_MIME_TYPES = {
    "image": {"image/jpeg", "image/png", "image/webp"},
    "audio": {
        "audio/aac",
        "audio/3gpp",
        "audio/m4a",
        "audio/mp4",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/x-m4a",
        "audio/x-wav",
    },
}


def decode_message_attachment(
    upload: MessageAttachmentUpload,
) -> tuple[MessageAttachment, bytes]:
    """Validate a data URL, enforce the media allowlist and return safe metadata + bytes."""
    mime_type = upload.mime_type.split(";", 1)[0].strip().lower()
    if mime_type not in ALLOWED_MESSAGE_MIME_TYPES[upload.kind]:
        raise HTTPException(status_code=400, detail="صيغة المرفق غير مدعومة")

    try:
        header, encoded = upload.data_url.split(",", 1)
        header_parts = header[5:].split(";") if header.lower().startswith("data:") else []
        header_mime_type = header_parts[0].strip().lower() if header_parts else ""
        if not header_parts or header_parts[-1].lower() != "base64":
            raise ValueError("expected a base64 data URL")
        if header_mime_type != mime_type:
            raise ValueError("media type mismatch")
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=400, detail="تعذر قراءة المرفق") from None

    if not content:
        raise HTTPException(status_code=400, detail="المرفق فارغ")
    if len(content) > MAX_MESSAGE_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="يجب ألا يتجاوز حجم المرفق 5 ميغابايت")

    return (
        MessageAttachment(kind=upload.kind, mime_type=mime_type, size_bytes=len(content)),
        content,
    )


def message_attachment_response(document: dict | None) -> Response:
    """Return a private, non-cacheable image/audio response for an authorized message."""
    if not document:
        raise HTTPException(status_code=404, detail="المرفق غير موجود")

    attachment = document.get("attachment") or {}
    content = document.get("attachment_data")
    kind = attachment.get("kind")
    mime_type = attachment.get("mime_type")
    if (
        kind not in ALLOWED_MESSAGE_MIME_TYPES
        or mime_type not in ALLOWED_MESSAGE_MIME_TYPES[kind]
        or not isinstance(content, (bytes, bytearray, memoryview))
    ):
        raise HTTPException(status_code=404, detail="المرفق غير موجود")

    return Response(
        content=bytes(content),
        media_type=mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
