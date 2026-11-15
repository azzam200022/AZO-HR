import base64

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from lib.employee_photo import employee_photo_response
from models.hr import Employee, EmployeeCreate, EmployeeUpdate


PHOTO_DATA = "data:image/jpeg;base64,/9j/2Q=="


def test_employee_photo_is_optional_and_round_trips_through_models():
    employee = Employee(
        name="Test", job_title="Test", hire_date="2026-11-01", has_photo=True
    )
    assert employee.has_photo
    assert "photo_data" not in employee.model_dump()

    created = EmployeeCreate(
        name="Test",
        job_title="Test",
        base_salary=1,
        hire_date="2026-11-01",
        photo_data=PHOTO_DATA,
    )
    assert created.photo_data == PHOTO_DATA
    assert EmployeeUpdate(photo_data=PHOTO_DATA).photo_data == PHOTO_DATA
    assert EmployeeUpdate(photo_data="").photo_data == ""


@pytest.mark.parametrize(
    "photo_data",
    [
        "https://example.com/photo.jpg",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "javascript:alert(1)",
    ],
)
def test_employee_photo_rejects_untrusted_image_sources(photo_data):
    with pytest.raises(ValidationError):
        EmployeeUpdate(photo_data=photo_data)


def test_employee_photo_rejects_data_larger_than_the_storage_limit():
    with pytest.raises(ValidationError):
        EmployeeUpdate(photo_data=PHOTO_DATA + ("A" * 420_000))


def test_employee_photo_response_returns_private_jpeg_bytes():
    response = employee_photo_response({"photo_data": PHOTO_DATA})

    assert response.media_type == "image/jpeg"
    assert response.body == base64.b64decode("/9j/2Q==")
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("photo_data", ["", "data:image/jpeg;base64,%%%"])
def test_employee_photo_response_rejects_missing_or_invalid_data(photo_data):
    with pytest.raises(HTTPException) as error:
        employee_photo_response({"photo_data": photo_data})
    assert error.value.status_code == 404
