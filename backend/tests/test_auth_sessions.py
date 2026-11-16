import sys
from datetime import datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException


class MemoryCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    @classmethod
    def _matches(cls, document, query):
        for key, expected in query.items():
            if key == "$or":
                if not any(cls._matches(document, option) for option in expected):
                    return False
                continue
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$exists" in expected and (key in document) != expected["$exists"]:
                    return False
                if "$gt" in expected and not (
                    actual is not None and actual > expected["$gt"]
                ):
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        return next(
            (document for document in self.documents if self._matches(document, query)),
            None,
        )

    def find(self, query):
        collection = self
        matched = [doc for doc in self.documents if self._matches(doc, query)]

        class Cursor:
            def __init__(self, documents):
                self.documents = documents

            def sort(self, key, direction):
                self.documents.sort(
                    key=lambda document: document.get(key),
                    reverse=direction < 0,
                )
                return self

            async def to_list(self, limit):
                return self.documents[:limit]

        return Cursor(matched)

    async def delete_many(self, query):
        self.documents = [
            document
            for document in self.documents
            if not self._matches(document, query)
        ]

    async def replace_one(self, query, replacement, *, upsert):
        for index, document in enumerate(self.documents):
            if self._matches(document, query):
                self.documents[index] = dict(replacement)
                return
        if upsert:
            self.documents.append(dict(replacement))

    async def update_one(self, query, update, upsert=False):
        for document in self.documents:
            if not self._matches(document, query):
                continue
            document.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                document.pop(key, None)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        matched = 0
        for document in self.documents:
            if not self._matches(document, query):
                continue
            matched += 1
            document.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                document.pop(key, None)
        return SimpleNamespace(matched_count=matched, modified_count=matched)

    async def insert_one(self, document):
        self.documents.append(dict(document))


def load_auth_module(database):
    database_module = ModuleType("lib.db")
    database_module.db = database
    module_name = "_auth_sessions_under_test"
    auth_path = Path(__file__).parents[1] / "lib" / "auth.py"
    spec = spec_from_file_location(module_name, auth_path)
    assert spec is not None and spec.loader is not None
    auth_module = module_from_spec(spec)

    with patch.dict(sys.modules, {"lib.db": database_module, module_name: auth_module}):
        spec.loader.exec_module(auth_module)
    return auth_module


@pytest.mark.asyncio
async def test_employee_login_replaces_old_sessions_and_device_push_registrations():
    sessions = MemoryCollection(
        [
            {"role": "employee", "employee_id": "employee-1", "token": "old-device-1"},
            {"role": "employee", "employee_id": "employee-1", "token": "old-device-2"},
            {"role": "employee", "employee_id": "employee-2", "token": "other-employee"},
            {"role": "manager", "employee_id": "", "token": "manager-session"},
        ]
    )
    push_tokens = MemoryCollection(
        [
            {"role": "employee", "employee_id": "employee-1", "token": "old-push-token"},
            {"role": "employee", "employee_id": "employee-2", "token": "other-push-token"},
            {"role": "manager", "employee_id": "", "token": "manager-push-token"},
        ]
    )
    web_push_subscriptions = MemoryCollection(
        [
            {"role": "employee", "employee_id": "employee-1", "endpoint": "old-endpoint"},
            {"role": "employee", "employee_id": "employee-2", "endpoint": "other-endpoint"},
            {"role": "manager", "employee_id": "", "endpoint": "manager-endpoint"},
        ]
    )
    database = SimpleNamespace(
        sessions=sessions,
        push_tokens=push_tokens,
        web_push_subscriptions=web_push_subscriptions,
        device_change_requests=MemoryCollection(),
        employees=MemoryCollection(),
    )
    auth = load_auth_module(database)

    token = await auth.create_session(
        "employee",
        email="employee@example.com",
        employee_id="employee-1",
        device_id="device-installation-id-employee-1",
    )

    employee_sessions = [
        item for item in sessions.documents if item.get("employee_id") == "employee-1"
    ]
    assert len(employee_sessions) == 1
    assert employee_sessions[0]["token"] == token
    assert employee_sessions[0]["device_id"] == "device-installation-id-employee-1"
    assert any(item["token"] == "manager-session" for item in sessions.documents)
    assert any(item["token"] == "other-employee" for item in sessions.documents)
    assert all(item["employee_id"] != "employee-1" for item in push_tokens.documents)
    assert all(item["employee_id"] != "employee-1" for item in web_push_subscriptions.documents)

    await auth.create_session("manager", email="manager@example.com")

    assert len(
        [item for item in sessions.documents if item.get("employee_id") == "employee-1"]
    ) == 1
    assert len([item for item in sessions.documents if item["role"] == "manager"]) == 2
    assert any(item["token"] == "manager-push-token" for item in push_tokens.documents)
    assert any(item["endpoint"] == "manager-endpoint" for item in web_push_subscriptions.documents)


@pytest.mark.asyncio
async def test_first_installation_is_bound_when_no_active_session_exists():
    employee = {
        "id": "employee-1",
        "name": "موظف تجريبي",
        "status": "active",
        "can_login": True,
    }
    database = SimpleNamespace(
        employees=MemoryCollection([employee]),
        sessions=MemoryCollection(),
        device_change_requests=MemoryCollection(),
        push_tokens=MemoryCollection(),
        web_push_subscriptions=MemoryCollection(),
    )
    auth = load_auth_module(database)

    await auth.require_trusted_employee_device(employee, "first-installation-id")

    assert database.employees.documents[0]["trusted_device_id"] == "first-installation-id"
    assert database.device_change_requests.documents == []


@pytest.mark.asyncio
async def test_new_installation_waits_for_manager_and_preserves_old_session():
    old_device = "previous-installation-id"
    new_device = "replacement-installation-id"
    employee = {
        "id": "employee-1",
        "name": "موظف تجريبي",
        "status": "active",
        "can_login": True,
        "trusted_device_id": old_device,
    }
    sessions = MemoryCollection(
        [
            {
                "role": "employee",
                "employee_id": "employee-1",
                "device_id": old_device,
                "token": "old-session",
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
        ]
    )
    database = SimpleNamespace(
        employees=MemoryCollection([employee]),
        sessions=sessions,
        device_change_requests=MemoryCollection(),
        push_tokens=MemoryCollection(),
        web_push_subscriptions=MemoryCollection(),
    )
    notify = ModuleType("lib.notify")
    notify.notify_manager_event = AsyncMock()
    with patch.dict(sys.modules, {"lib.notify": notify}):
        auth = load_auth_module(database)
        with pytest.raises(HTTPException) as first_attempt:
            await auth.require_trusted_employee_device(employee, new_device)
        with pytest.raises(HTTPException) as repeated_attempt:
            await auth.require_trusted_employee_device(employee, new_device)

    assert first_attempt.value.status_code == 403
    assert "أُرسل طلب الدخول" in first_attempt.value.detail
    assert repeated_attempt.value.status_code == 403
    assert len(database.device_change_requests.documents) == 1
    request = database.device_change_requests.documents[0]
    assert request["previous_device_id"] == old_device
    assert request["device_id"] == new_device
    assert request["status"] == "pending"
    assert sessions.documents[0]["token"] == "old-session"
    notify.notify_manager_event.assert_awaited_once()
    assert notify.notify_manager_event.await_args.kwargs["device_request_id"] == request["id"]


@pytest.mark.asyncio
async def test_legacy_active_session_requires_approval_before_device_enrollment():
    employee = {
        "id": "employee-legacy",
        "name": "موظف قديم",
        "status": "active",
        "can_login": True,
    }
    sessions = MemoryCollection(
        [
            {
                "role": "employee",
                "employee_id": "employee-legacy",
                "token": "legacy-session",
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
        ]
    )
    database = SimpleNamespace(
        employees=MemoryCollection([employee]),
        sessions=sessions,
        device_change_requests=MemoryCollection(),
        push_tokens=MemoryCollection(),
        web_push_subscriptions=MemoryCollection(),
    )
    notify = ModuleType("lib.notify")
    notify.notify_manager_event = AsyncMock()
    with patch.dict(sys.modules, {"lib.notify": notify}):
        auth = load_auth_module(database)
        with pytest.raises(HTTPException) as attempt:
            await auth.require_trusted_employee_device(employee, "new-installation-id")

    assert attempt.value.status_code == 403
    assert "أُرسل طلب الدخول" in attempt.value.detail
    assert "trusted_device_id" not in database.employees.documents[0]
    assert sessions.documents[0]["token"] == "legacy-session"
    assert database.device_change_requests.documents[0]["previous_device_id"] == ""


def load_notifications_router(monkeypatch, database):
    import importlib

    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "device_approval_test")
    module = importlib.import_module("routers.notifications")
    monkeypatch.setattr(module, "db", database)
    return module


@pytest.mark.asyncio
async def test_manager_approval_trusts_new_device_and_revokes_old_session(monkeypatch):
    employee_id = "employee-approval"
    request_id = "request-approval"
    old_device = "old-device-installation"
    new_device = "new-device-installation"
    employee = {
        "id": employee_id,
        "name": "موظف تجريبي",
        "status": "active",
        "can_login": True,
        "trusted_device_id": old_device,
    }
    request = {
        "id": request_id,
        "employee_id": employee_id,
        "employee_name": employee["name"],
        "device_id": new_device,
        "previous_device_id": old_device,
        "status": "pending",
        "pending_employee_id": employee_id,
        "created_at": datetime.now(timezone.utc),
    }
    database = SimpleNamespace(
        employees=MemoryCollection([employee]),
        device_change_requests=MemoryCollection([request]),
        sessions=MemoryCollection(
            [
                {"role": "employee", "employee_id": employee_id, "token": "old-session"},
                {"role": "employee", "employee_id": "employee-2", "token": "other-session"},
                {"role": "manager", "employee_id": "", "token": "manager-session"},
            ]
        ),
        push_tokens=MemoryCollection(
            [
                {"role": "employee", "employee_id": employee_id, "token": "old-push"},
                {"role": "employee", "employee_id": "employee-2", "token": "other-push"},
            ]
        ),
        web_push_subscriptions=MemoryCollection(
            [
                {"role": "employee", "employee_id": employee_id, "endpoint": "old-endpoint"},
                {"role": "employee", "employee_id": "employee-2", "endpoint": "other-endpoint"},
            ]
        ),
        notifications=MemoryCollection(
            [
                {"id": "note-1", "device_request_id": request_id, "read": False},
                {"id": "note-2", "device_request_id": "other-request", "read": False},
            ]
        ),
    )
    router = load_notifications_router(monkeypatch, database)

    result = await router.approve_device_change_request(request_id)

    assert result.status == "approved"
    assert database.employees.documents[0]["trusted_device_id"] == new_device
    assert [item["token"] for item in database.sessions.documents] == [
        "other-session",
        "manager-session",
    ]
    assert [item["token"] for item in database.push_tokens.documents] == ["other-push"]
    assert [item["endpoint"] for item in database.web_push_subscriptions.documents] == [
        "other-endpoint"
    ]
    assert database.device_change_requests.documents[0]["status"] == "approved"
    assert "pending_employee_id" not in database.device_change_requests.documents[0]
    assert database.notifications.documents[0]["read"] is True
    assert database.notifications.documents[1]["read"] is False


@pytest.mark.asyncio
async def test_manager_rejection_keeps_existing_device_and_session(monkeypatch):
    employee_id = "employee-rejection"
    request_id = "request-rejection"
    old_device = "trusted-installation"
    employee = {
        "id": employee_id,
        "name": "موظف تجريبي",
        "status": "active",
        "can_login": True,
        "trusted_device_id": old_device,
    }
    database = SimpleNamespace(
        employees=MemoryCollection([employee]),
        device_change_requests=MemoryCollection(
            [
                {
                    "id": request_id,
                    "employee_id": employee_id,
                    "device_id": "unapproved-installation",
                    "previous_device_id": old_device,
                    "status": "pending",
                    "pending_employee_id": employee_id,
                }
            ]
        ),
        sessions=MemoryCollection(
            [{"role": "employee", "employee_id": employee_id, "token": "old-session"}]
        ),
        push_tokens=MemoryCollection(),
        web_push_subscriptions=MemoryCollection(),
        notifications=MemoryCollection(
            [{"id": "note-1", "device_request_id": request_id, "read": False}]
        ),
    )
    router = load_notifications_router(monkeypatch, database)

    result = await router.reject_device_change_request(request_id)

    assert result.status == "rejected"
    assert database.employees.documents[0]["trusted_device_id"] == old_device
    assert database.sessions.documents[0]["token"] == "old-session"
    assert database.device_change_requests.documents[0]["status"] == "rejected"
    assert "pending_employee_id" not in database.device_change_requests.documents[0]
    assert database.notifications.documents[0]["read"] is True
