import base64
import binascii

from fastapi import HTTPException
from fastapi.responses import Response


def _photo_response(record: dict, missing_detail: str, invalid_detail: str) -> Response:
    photo_data = record.get("photo_data", "")
    if not photo_data:
        raise HTTPException(status_code=404, detail=missing_detail)
    try:
        header, encoded = photo_data.split(",", 1)
        if header != "data:image/jpeg;base64":
            raise ValueError("unsupported photo format")
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=404, detail=invalid_detail) from None
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store"},
    )


def employee_photo_response(employee: dict) -> Response:
    return _photo_response(employee, "لا توجد صورة لهذا الموظف", "صورة الموظف غير متاحة")


def product_photo_response(product: dict) -> Response:
    return _photo_response(product, "لا توجد صورة لهذه المادة", "صورة المادة غير متاحة")
