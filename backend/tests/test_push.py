import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError


def test_web_push_subscription_only_accepts_chrome_push_service(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "push_test")

    from routers.auth import WebPushEndpointRequest, WebPushSubscriptionRequest

    subscription = WebPushSubscriptionRequest.model_validate(
        {
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint",
            "keys": {"p256dh": "test-p256dh", "auth": "test-auth"},
        }
    )
    assert subscription.endpoint.startswith("https://fcm.googleapis.com/")
    assert WebPushEndpointRequest.model_validate(
        {"endpoint": subscription.endpoint}
    ).endpoint == subscription.endpoint

    with pytest.raises(ValidationError):
        WebPushSubscriptionRequest.model_validate(
            {
                "endpoint": "https://example.com/fcm/send/test-endpoint",
                "keys": {"p256dh": "test-p256dh", "auth": "test-auth"},
            }
        )


def test_push_is_a_noop_without_firebase_configuration(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "push_test")
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_PRIVATE_KEY", raising=False)

    from lib import push

    monkeypatch.setattr(push, "_app", None)

    asyncio.run(
        push.send_notification(
            {
                "id": "test-note",
                "audience": "employee",
                "employee_id": "test-employee",
                "kind": "message",
            }
        )
    )


class _Cursor:
    async def to_list(self, limit):
        return [{"token": "test-token"}]


class _PushTokens:
    def find(self, query):
        assert query == {"role": "employee", "employee_id": "test-employee"}
        return _Cursor()


class _Employees:
    async def find_one(self, query, projection):
        assert query == {"id": "test-employee"}
        assert projection == {"status": 1, "can_login": 1}
        return {"status": "active", "can_login": True}


def test_push_uses_notification_content(monkeypatch):
    from lib import push

    sent = {}
    app = object()
    monkeypatch.setattr(push, "_firebase_app", lambda: app)
    monkeypatch.setattr(push, "_web_push_config", lambda: None)
    monkeypatch.setattr(
        push,
        "db",
        SimpleNamespace(push_tokens=_PushTokens(), employees=_Employees()),
    )
    monkeypatch.setattr(push.messaging, "Notification", lambda **kwargs: SimpleNamespace(**kwargs))
    monkeypatch.setattr(push.messaging, "Message", lambda **kwargs: SimpleNamespace(**kwargs))
    monkeypatch.setattr(
        push.messaging,
        "send",
        lambda message, app: sent.update(message=message, app=app) or "message-id",
    )

    asyncio.run(
        push.send_notification(
            {
                "id": "note-1",
                "audience": "employee",
                "employee_id": "test-employee",
                "kind": "bonus",
                "message": "تم تسجيل حافز بقيمة 100,000 د.ع. السبب: إنجاز العمل",
            }
        )
    )

    assert sent["app"] is app
    assert sent["message"].notification.title == "حافز جديد"
    assert sent["message"].notification.body == (
        "تم تسجيل حافز بقيمة 100,000 د.ع. السبب: إنجاز العمل"
    )
    assert sent["message"].data["notification_id"] == "note-1"


def test_web_push_includes_full_notification_content_without_firebase(monkeypatch):
    from lib import push
    from py_vapid import Vapid

    monkeypatch.delenv("WEB_PUSH_VAPID_SUBJECT", raising=False)
    sent = {}

    class _Subscriptions:
        async def to_list(self, limit):
            return [
                {
                    "subscription": {
                        "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint",
                        "keys": {"p256dh": "test-p256dh", "auth": "test-auth"},
                    }
                }
            ]

    class _WebPushCollection:
        def find(self, query):
            assert query == {"role": "manager", "email": "manager@example.test"}
            return _Subscriptions()

    monkeypatch.setattr(push, "_firebase_app", lambda: None)
    monkeypatch.setattr(push, "_web_push_config", lambda: ("public-key", "private-key"))
    monkeypatch.setattr(push, "manager_email", lambda: "manager@example.test")
    monkeypatch.setattr(
        push,
        "db",
        SimpleNamespace(web_push_subscriptions=_WebPushCollection()),
    )
    monkeypatch.setattr(
        push,
        "webpush",
        lambda **kwargs: sent.update(kwargs) or "sent",
    )

    asyncio.run(
        push.send_notification(
            {
                "id": "note-2",
                "audience": "manager",
                "kind": "payroll",
                "message": "تفاصيل راتب سرية",
            }
        )
    )

    assert sent["subscription_info"]["endpoint"].startswith("https://fcm.googleapis.com/")
    assert sent["vapid_private_key"] == "private-key"
    payload = json.loads(sent["data"])
    assert payload["title"] == "تسوية الراتب"
    assert payload["body"] == "تفاصيل راتب سرية"
    assert payload["tag"] == "mawaridi-note-2"
    assert payload["data"] == {
        "notification_id": "note-2",
        "kind": "payroll",
        "audience": "manager",
    }
    assert sent["ttl"] == 3600
    assert sent["vapid_claims"] == {"sub": "https://azzam200022.github.io"}

    vapid = Vapid()
    vapid.generate_keys()
    vapid.sign({**sent["vapid_claims"], "aud": "https://fcm.googleapis.com"})

def test_web_push_config_is_not_cached(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "push_test")

    from fastapi import Response
    from routers.auth import web_push_config

    configs = iter(
        [
            ("public-key-one", "private-key-one"),
            ("public-key-two", "private-key-two"),
        ]
    )
    monkeypatch.setattr(
        "routers.auth.get_web_push_config",
        lambda: next(configs),
    )

    response = Response()
    first_config = asyncio.run(web_push_config(response))
    second_config = asyncio.run(web_push_config(Response()))

    assert first_config["public_key"] == "public-key-one"
    assert second_config["public_key"] == "public-key-two"
    assert response.headers["cache-control"] == "no-store"
