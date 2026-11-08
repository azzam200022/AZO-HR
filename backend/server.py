import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes
from lib.auth import ensure_manager_account
from lib.shift_reminders import run_shift_reminder_scheduler


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    await ensure_manager_account()
    app.state.shift_reminder_task = asyncio.create_task(
        run_shift_reminder_scheduler(app.state.index_task)
    )
    yield
    app.state.shift_reminder_task.cancel()
    app.state.index_task.cancel()
    await asyncio.gather(
        app.state.shift_reminder_task,
        app.state.index_task,
        return_exceptions=True,
    )
    client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

from routers.employees import router as employees_router
from routers.attendance import router as attendance_router
from routers.leaves import router as leaves_router
from routers.payroll import router as payroll_router
from routers.dashboard import router as dashboard_router
from routers.locations import router as locations_router
from routers.auth import router as auth_router
from routers.me import router as me_router
from routers.adjustments import router as adjustments_router
from routers.messages import router as messages_router
from routers.notifications import router as notifications_router
from routers.reports import router as reports_router

api_router.include_router(auth_router)
api_router.include_router(me_router)
api_router.include_router(employees_router)
api_router.include_router(attendance_router)
api_router.include_router(leaves_router)
api_router.include_router(payroll_router)
api_router.include_router(locations_router)
api_router.include_router(dashboard_router)
api_router.include_router(adjustments_router)
api_router.include_router(messages_router)
api_router.include_router(notifications_router)
api_router.include_router(reports_router)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# In the Render production build, the frontend is compiled from the repository root
# into frontend/dist and served by this same origin as /api. Local API-only runs remain
# supported when the frontend has not been built.
FRONTEND_DIST = ROOT_DIR.parent / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"

if FRONTEND_INDEX.is_file():
    resolved_frontend_dist = FRONTEND_DIST.resolve()

    @app.get("/{asset_path:path}", include_in_schema=False)
    async def serve_frontend(asset_path: str):
        # Do not turn unknown API routes into HTML responses.
        if asset_path == "api" or asset_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        requested_file = (FRONTEND_DIST / asset_path).resolve()
        try:
            requested_file.relative_to(resolved_frontend_dist)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not Found")

        if requested_file.is_file():
            headers = (
                {"Cache-Control": "no-store"}
                if requested_file == FRONTEND_INDEX.resolve()
                else None
            )
            return FileResponse(requested_file, headers=headers)

        # Client-side routes such as /employees and /me/profile belong to React Router.
        # File-like misses remain 404s so missing JS/CSS is not answered with index.html.
        if asset_path.startswith("assets/") or Path(asset_path).suffix:
            raise HTTPException(status_code=404, detail="Not Found")

        return FileResponse(FRONTEND_INDEX, headers={"Cache-Control": "no-store"})
