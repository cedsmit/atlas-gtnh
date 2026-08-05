"""Underground-fluid fields cached by Visual Prospecting."""

import asyncio

from fastapi import APIRouter, Query

from app.models.bedrock_fluids import BedrockFluidsResponse
from app.services.bedrock_fluid_service import get_bedrock_fluids

router = APIRouter()


@router.get("/bedrock-fluids", response_model=BedrockFluidsResponse)
async def bedrock_fluids(
    world_path: str = Query(..., description="dimension path (contains region/)"),
) -> BedrockFluidsResponse:
    """Measured fields plus pristine predictions for generated terrain."""
    return await asyncio.to_thread(get_bedrock_fluids, world_path)
