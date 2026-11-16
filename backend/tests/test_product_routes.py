import base64
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from lib.employee_photo import product_photo_response
from models.hr import EmployeeProductCreate, EmployeeProductUpdate


PHOTO_DATA = "data:image/jpeg;base64,/9j/2Q=="


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

    async def insert_one(self, document):
        self.documents.append(document)
        return SimpleNamespace(inserted_id=document["id"])

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
async def test_employee_can_add_product_photo_without_exposing_image_data(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    products = _Collection()
    monkeypatch.setattr(
        me,
        "db",
        SimpleNamespace(
            employees=_Collection([{"id": "employee-1"}]),
            employee_products=products,
        ),
    )
    monkeypatch.setattr(me, "today_iso", lambda: "2026-11-16")

    result = await me.add_my_product(
        EmployeeProductCreate(
            name="حليب",
            expiry_dates=["2026-12-15"],
            photo_data=PHOTO_DATA,
        ),
        Principal(role="employee", employee_id="employee-1"),
    )

    assert result.has_photo is True
    assert "photo_data" not in result.model_dump()
    assert products.documents[0]["photo_data"] == PHOTO_DATA


@pytest.mark.asyncio
async def test_employee_can_view_only_their_own_product_photo(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    product = _product()
    product["photo_data"] = PHOTO_DATA
    products = _Collection([product])
    monkeypatch.setattr(
        me,
        "db",
        SimpleNamespace(employee_products=products),
    )

    response = await me.my_product_photo(
        "product-1",
        Principal(role="employee", employee_id="employee-1"),
    )

    assert response.media_type == "image/jpeg"
    assert response.body == base64.b64decode("/9j/2Q==")
    assert response.headers["cache-control"] == "private, no-store"

    with pytest.raises(HTTPException) as error:
        await me.my_product_photo(
            "product-1",
            Principal(role="employee", employee_id="employee-2"),
        )
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_employee_can_remove_their_product_photo(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "product_routes_test")

    from lib.auth import Principal
    from routers import me

    product = _product()
    product["photo_data"] = PHOTO_DATA
    products = _Collection([product])
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
        EmployeeProductUpdate(photo_data=None),
        Principal(role="employee", employee_id="employee-1"),
    )

    assert result.has_photo is False
    assert products.documents[0]["photo_data"] is None


@pytest.mark.parametrize(
    "photo_data",
    ["https://example.com/image.jpg", "data:image/svg+xml;base64,PHN2Zy8+"],
)
def test_product_models_reject_untrusted_image_sources(photo_data):
    with pytest.raises(ValidationError):
        EmployeeProductCreate(
            name="حليب",
            expiry_dates=["2026-12-15"],
            photo_data=photo_data,
        )


def test_product_model_rejects_image_data_larger_than_the_storage_limit():
    with pytest.raises(ValidationError):
        EmployeeProductCreate(
            name="حليب",
            expiry_dates=["2026-12-15"],
            photo_data=PHOTO_DATA + ("A" * 420_000),
        )


def test_product_photo_response_returns_private_jpeg_bytes():
    response = product_photo_response({"photo_data": PHOTO_DATA})

    assert response.media_type == "image/jpeg"
    assert response.body == base64.b64decode("/9j/2Q==")
    assert response.headers["cache-control"] == "private, no-store"


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
