from fastapi import APIRouter, Depends

from lib.auth import require_manager
from lib.dates import current_month
from lib.discipline import build_discipline_report
from models.hr import DisciplineReport

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_manager)])


@router.get("/discipline", response_model=DisciplineReport)
async def discipline_report(month: str | None = None):
    """Monthly punctuality ranking across all active employees."""
    return await build_discipline_report(month or current_month())
