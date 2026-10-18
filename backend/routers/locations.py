from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.dates import aware
from lib.db import db
from models.hr import DeleteResult, WorkLocation, WorkLocationCreate, WorkLocationUpdate

router = APIRouter(prefix="/locations", tags=["locations"], dependencies=[Depends(require_manager)])


def _to_model(doc: dict) -> WorkLocation:
    doc["created_at"] = aware(doc.get("created_at"))
    return WorkLocation(**doc)


@router.get("", response_model=list[WorkLocation])
async def list_locations():
    docs = await db.locations.find().sort("created_at", -1).to_list(1000)
    return [_to_model(d) for d in docs]


@router.post("", response_model=WorkLocation, status_code=201)
async def create_location(payload: WorkLocationCreate):
    location = WorkLocation(**payload.model_dump())
    await db.locations.insert_one(location.model_dump())
    return location


@router.put("/{location_id}", response_model=WorkLocation)
async def update_location(location_id: str, payload: WorkLocationUpdate):
    doc = await db.locations.find_one({"id": location_id})
    if not doc:
        raise HTTPException(status_code=404, detail="موقع العمل غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        await db.locations.update_one({"id": location_id}, {"$set": updates})
    fresh = await db.locations.find_one({"id": location_id})
    return _to_model(fresh)


@router.delete("/{location_id}", response_model=DeleteResult)
async def delete_location(location_id: str):
    result = await db.locations.delete_one({"id": location_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="موقع العمل غير موجود")
    # Unassign the geofence from employees who were bound to it
    await db.employees.update_many({"location_id": location_id}, {"$set": {"location_id": ""}})
    return DeleteResult(id=location_id, deleted=True)