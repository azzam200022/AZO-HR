import base64
import binascii

from fastapi import HTTPException
from fastapi.responses import Response


def employee_photo_response(employee: dict) -> Response:
    photo_data = employee.get("photo_data", "")
    if not photo_data:
        raise HTTPException(status_code=404, detail="لا توجد صورة لهذا الموظف")
    try:
        header, encoded = photo_data.split(",", 1)
        if header != "data:image/jpeg;base64":
            raise ValueError("unsupported photo format")
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=404, detail="صورة الموظف غير متاحة") from None
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store"},
    )
