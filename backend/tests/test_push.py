import asyncio
from types import SimpleNamespace


def test_push_is_a_noop_without_firebase_configuration(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "push_test")
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON", raising=False)

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
