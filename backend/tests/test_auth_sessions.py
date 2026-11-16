import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import pytest


class MemoryCollection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    async def delete_many(self, query):
        self.documents = [
            document
            for document in self.documents
            if not all(document.get(key) == value for key, value in query.items())
        ]

    async def replace_one(self, query, replacement, *, upsert):
        for index, document in enumerate(self.documents):
            if all(document.get(key) == value for key, value in query.items()):
                self.documents[index] = dict(replacement)
                return
        if upsert:
            self.documents.append(dict(replacement))

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
    )
    auth = load_auth_module(database)

    token = await auth.create_session(
        "employee", email="employee@example.com", employee_id="employee-1"
    )

    employee_sessions = [
        item for item in sessions.documents if item.get("employee_id") == "employee-1"
    ]
    assert len(employee_sessions) == 1
    assert employee_sessions[0]["token"] == token
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
