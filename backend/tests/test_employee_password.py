from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.hr import EmployeeCreate


class _EmployeeCollection:
    def __init__(self):
        self.documents = []

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
