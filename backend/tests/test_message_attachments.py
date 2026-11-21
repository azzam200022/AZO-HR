import base64

import pytest
from fastapi import HTTPException

from lib.message_attachments import decode_message_attachment, message_attachment_response
from models.hr import MessageAttachment, MessageAttachmentUpload


def upload(kind: str, mime_type: str, content: bytes) -> MessageAttachmentUpload:
    encoded = base64.b64encode(content).decode("ascii")
    return MessageAttachmentUpload(
        kind=kind,
        mime_type=mime_type,
        data_url=f"data:{mime_type};base64,{encoded}",
    )


def test_decode_image_attachment_returns_metadata_and_bytes():
    content = b"\xff\xd8\xfftest image"

    metadata, decoded = decode_message_attachment(upload("image", "image/jpeg", content))

    assert metadata == MessageAttachment(kind="image", mime_type="image/jpeg", size_bytes=len(content))
    assert decoded == content


def test_decode_audio_attachment_accepts_codec_parameters_in_data_url():
    content = b"\x1a\x45\xdf\xa3webm audio"
    encoded = base64.b64encode(content).decode("ascii")
    request = MessageAttachmentUpload(
        kind="audio",
        mime_type="audio/webm",
        data_url=f"data:audio/webm;codecs=opus;base64,{encoded}",
    )

    metadata, decoded = decode_message_attachment(request)

    assert metadata.mime_type == "audio/webm"
    assert decoded == content


def test_decode_message_attachment_rejects_unsupported_media_type():
    request = upload("image", "image/svg+xml", b"<svg></svg>")

    with pytest.raises(HTTPException) as error:
        decode_message_attachment(request)

    assert error.value.status_code == 400


def test_decode_message_attachment_rejects_mime_type_mismatch():
    request = MessageAttachmentUpload(
        kind="image",
        mime_type="image/jpeg",
        data_url="data:image/png;base64,aGVsbG8=",
    )

    with pytest.raises(HTTPException) as error:
        decode_message_attachment(request)

    assert error.value.status_code == 400


def test_message_attachment_response_is_private_and_nosniff():
    response = message_attachment_response(
        {
            "attachment": {"kind": "audio", "mime_type": "audio/webm"},
            "attachment_data": b"voice note",
        }
    )

    assert response.body == b"voice note"
    assert response.media_type == "audio/webm"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_message_attachment_response_hides_missing_media():
    with pytest.raises(HTTPException) as error:
        message_attachment_response({"attachment": None, "attachment_data": b""})

    assert error.value.status_code == 404
