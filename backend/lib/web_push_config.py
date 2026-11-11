"""Validate the VAPID key pair used by browser push notifications."""

import base64
import binascii
import hmac
import logging
import os

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

logger = logging.getLogger(__name__)


def _decode_public_key(value: str) -> bytes:
    padded = value + "=" * ((4 - len(value) % 4) % 4)
    return base64.b64decode(padded, altchars=b"-_", validate=True)


def get_web_push_config() -> tuple[str, str] | None:
    """Return a valid matching VAPID public/private pair, without exposing secrets."""
    public_key = os.environ.get("WEB_PUSH_VAPID_PUBLIC_KEY", "").strip()
    private_key = os.environ.get("WEB_PUSH_VAPID_PRIVATE_KEY", "").strip()
    if not public_key or not private_key:
        return None

    try:
        decoded_public_key = _decode_public_key(public_key)
    except (binascii.Error, ValueError):
        logger.warning("Web Push VAPID public key has invalid encoding")
        return None

    if len(decoded_public_key) != 65 or decoded_public_key[0] != 0x04:
        logger.warning("Web Push VAPID public key has invalid length or format")
        return None

    try:
        vapid = Vapid.from_string(private_key)
        derived_public_key = vapid.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )
    except Exception as exc:
        logger.warning("Web Push VAPID private key is invalid (%s)", type(exc).__name__)
        return None

    if not hmac.compare_digest(decoded_public_key, derived_public_key):
        logger.warning("Web Push VAPID public and private keys do not match")
        return None

    normalized_public_key = base64.urlsafe_b64encode(decoded_public_key).decode().rstrip("=")
    return normalized_public_key, private_key
