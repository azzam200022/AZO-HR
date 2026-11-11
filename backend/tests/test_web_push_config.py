import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

from lib.web_push_config import get_web_push_config


def _make_vapid_pair():
    vapid = Vapid()
    vapid.generate_keys()
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    public_key = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    private_key = vapid.private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return encode(public_key), encode(private_key)


def _set_vapid_config(monkeypatch, public_key, private_key):
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", public_key)
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", private_key)


def test_web_push_config_accepts_a_matching_vapid_pair(monkeypatch):
    public_key, private_key = _make_vapid_pair()
    _set_vapid_config(monkeypatch, public_key, private_key)

    assert get_web_push_config() == (public_key, private_key)


def test_web_push_config_normalizes_padding_on_public_key(monkeypatch):
    public_key, private_key = _make_vapid_pair()
    _set_vapid_config(monkeypatch, f"{public_key}=", private_key)

    assert get_web_push_config() == (public_key, private_key)


def test_web_push_config_rejects_a_37_byte_public_key(monkeypatch):
    _, private_key = _make_vapid_pair()
    malformed_public_key = (
        base64.urlsafe_b64encode(bytes(37)).decode().rstrip("=")
    )
    _set_vapid_config(monkeypatch, malformed_public_key, private_key)

    assert get_web_push_config() is None


def test_web_push_config_rejects_mismatched_vapid_keys(monkeypatch):
    public_key, _ = _make_vapid_pair()
    _, private_key = _make_vapid_pair()
    _set_vapid_config(monkeypatch, public_key, private_key)

    assert get_web_push_config() is None


def test_web_push_config_rejects_an_invalid_private_key(monkeypatch):
    public_key, _ = _make_vapid_pair()
    _set_vapid_config(monkeypatch, public_key, "not-a-vapid-key")

    assert get_web_push_config() is None
