from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.hr import EmployeeProductUpdate


class _Collection:
    def __init__(self, documents=()):
        self.documents = list(documents)

    async def find_one(self, query):
        return next(
            (
                document
                for document in self.documents
                if all(document.get(key) == value for key, value in query.items())
            ),
            None,
        )

    async def update_one(self, query, update):
        document = await self.find_one(query)
        if document:
            document.update(update["$set"])
        return SimpleNamespace(matched_count=int(document is not None))

    async def delete_one(self, query):
        document = await self.find_one(query)
        if document:
            self.documents.remove(document)
        return SimpleNamespace(deleted_count=int(document is not None))


def _product(employee_id="employee-1"):
    return {
        "id": "product-1",
        "employee_id": employee_id,
        "name": "حليب",
        "expiry_dates": [{"id": "batch-1", "expiry_date": "2026-12-15"}],
        "created_at": datetime(2026, 11, 1, tzinfo=timezone.utc),
    }


@pytest.mark.asyncio
async def test_employee_can_rename_product_add_expiry_date_and_set_reminder(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    products = _Collection([_product()])
    monkeypatch.setattr(
        me,
        "db",
        SimpleNamespace(
            employees=_Collection([{"id": "employee-1"}]),
            employee_products=products,
        ),
    )
    monkeypatch.setattr(me, "today_iso", lambda: "2026-11-16")

    result = await me.update_my_product(
        "product-1",
        EmployeeProductUpdate(
            name="لبن",
            add_expiry_date="2027-01-10",
            custom_reminder_days=5,
        ),
        Principal(role="employee", employee_id="employee-1"),
    )

    assert result.name == "لبن"
    assert result.custom_reminder_days == 5
    assert [batch.expiry_date for batch in result.expiry_dates] == [
        "2026-12-15",
        "2027-01-10",
    ]
    assert products.documents[0]["employee_id"] == "employee-1"


@pytest.mark.asyncio
async def test_employee_cannot_update_another_employees_product(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    products = _Collection([_product(employee_id="employee-2")])
    monkeypatch.setattr(
        me,
        "db",
        SimpleNamespace(
            employees=_Collection([{"id": "employee-1"}]),
            employee_products=products,
        ),
    )

    with pytest.raises(HTTPException) as exc:
        await me.update_my_product(
            "product-1",
            EmployeeProductUpdate(name="لبن"),
            Principal(role="employee", employee_id="employee-1"),
        )

    assert exc.value.status_code == 404
    assert products.documents[0]["name"] == "حليب"


@pytest.mark.asyncio
async def test_employee_can_delete_only_their_own_product(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    products = _Collection([_product()])
    monkeypatch.setattr(
        me,
        "db",
        SimpleNamespace(
            employees=_Collection([{"id": "employee-1"}]),
            employee_products=products,
        ),
    )

    result = await me.delete_my_product(
        "product-1",
        Principal(role="employee", employee_id="employee-1"),
    )

    assert result.id == "product-1"
    assert result.deleted is True
    assert products.documents == []
