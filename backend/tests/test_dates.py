from lib.dates import _zone


def test_default_timezone_is_baghdad(monkeypatch):
    monkeypatch.delenv("APP_TZ", raising=False)

    assert _zone().key == "Asia/Baghdad"


def test_app_timezone_environment_override(monkeypatch):
    monkeypatch.setenv("APP_TZ", "UTC")

    assert _zone().key == "UTC"


def test_explicit_timezone_overrides_environment(monkeypatch):
    monkeypatch.setenv("APP_TZ", "UTC")

    assert _zone("Asia/Baghdad").key == "Asia/Baghdad"
