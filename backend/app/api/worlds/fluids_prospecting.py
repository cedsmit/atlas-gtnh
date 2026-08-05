"""Underground-fluid fields cached by Visual Prospecting."""

import asyncio

from fastapi import APIRouter, Query

from app.models.fluids_prospecting import FluidsProspectingResponse
from app.services.fluids_prospecting_service import get_fluids_prospecting

router = APIRouter()


@router.get("/fluids-prospecting", response_model=FluidsProspectingResponse)
async def fluids_prospecting(
    world_path: str = Query(..., description="dimension path (contains region/)"),
) -> FluidsProspectingResponse:
    """Measured fields plus pristine predictions for generated terrain."""
    return await asyncio.to_thread(get_fluids_prospecting, world_path)
