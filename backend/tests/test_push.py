import asyncio


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
