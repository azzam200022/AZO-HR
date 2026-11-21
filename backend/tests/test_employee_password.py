from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from models.hr import EmployeeCreate


class _EmployeeCollection:
    def __init__(self, duplicate_on_insert=()):
        self.documents = []
        self.duplicate_on_insert = set(duplicate_on_insert)

    async def find_one(self, query):
        return next(
            (
                document
                for document in self.documents
                if all(document.get(key) == value for key, value in query.items())
            ),
            None,
        )

    async def insert_one(self, document):
        if document["access_code"] in self.duplicate_on_insert:
            self.duplicate_on_insert.remove(document["access_code"])
            raise DuplicateKeyError(
                "duplicate access code", details={"keyPattern": {"access_code": 1}}
            )
        self.documents.append(document)
        return SimpleNamespace(inserted_id=document["id"])


def _payload(**overrides):
    values = {
        "name": "موظف تجريبي",
        "job_title": "محاسب",
        "email": "employee@example.com",
        "base_salary": 0,
        "hire_date": "2026-11-21",
    }
    return EmployeeCreate(**(values | overrides))


@pytest.mark.asyncio
async def test_create_employee_hashes_password_and_does_not_return_it(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "employee_password_test")

    from lib.auth import verify_password
    from routers import employees

    collection = _EmployeeCollection()
    monkeypatch.setattr(employees, "db", SimpleNamespace(employees=collection))

    result = await employees.create_employee(_payload(password="secure-pass-123"))

    saved = collection.documents[0]
    assert saved["password_hash"] != "secure-pass-123"
    assert verify_password("secure-pass-123", saved["password_hash"])
    assert "password" not in saved
    assert "password_hash" not in result.model_dump()
    assert "password" not in result.model_dump()


@pytest.mark.asyncio
async def test_create_employee_requires_email_when_password_is_set(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "employee_password_test")

    from routers import employees

    collection = _EmployeeCollection()
    monkeypatch.setattr(employees, "db", SimpleNamespace(employees=collection))

    with pytest.raises(HTTPException) as error:
        await employees.create_employee(_payload(email="", password="secure-pass-123"))

    assert error.value.status_code == 400
    assert collection.documents == []


def test_create_employee_rejects_short_passwords():
    with pytest.raises(ValidationError):
        _payload(password="12345")


def test_employee_access_code_index_is_unique_for_nonempty_codes(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "employee_password_test")

    from lib.db import INDEXES

    index = next(
        model
        for model in INDEXES["employees"]
        if model.document["name"] == "access_code_unique"
    )

    assert index.document["unique"] is True
    assert index.document["partialFilterExpression"] == {
        "access_code": {"$type": "string", "$gt": ""}
    }


@pytest.mark.asyncio
async def test_create_employee_without_password_keeps_access_code_login(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "employee_password_test")

    from routers import employees

    collection = _EmployeeCollection()
    monkeypatch.setattr(employees, "db", SimpleNamespace(employees=collection))

    result = await employees.create_employee(_payload(password=""))

    assert result.access_code
    assert "password_hash" not in collection.documents[0]


@pytest.mark.asyncio
async def test_create_employee_retries_access_code_collision(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "employee_password_test")

    from routers import employees

    collection = _EmployeeCollection(duplicate_on_insert={"MW-1111"})
    monkeypatch.setattr(employees, "db", SimpleNamespace(employees=collection))
    codes = iter(("MW-1111", "MW-2222"))
    monkeypatch.setattr(employees, "new_access_code", lambda: next(codes))

    result = await employees.create_employee(_payload())

    assert result.access_code == "MW-2222"
    assert collection.documents[0]["access_code"] == "MW-2222"
