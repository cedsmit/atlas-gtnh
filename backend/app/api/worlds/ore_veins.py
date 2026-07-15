"""Ore-vein endpoint — GregTech veins cached by Visual Prospecting."""

import asyncio

from fastapi import APIRouter, Query

from app.models.ore_veins import OreVeinsResponse
from app.services.visual_prospecting_service import get_ore_veins

router = APIRouter()


@router.get("/ore-veins", response_model=OreVeinsResponse)
async def ore_veins(
    world_path: str = Query(..., description="dimension path (contains region/)"),
) -> OreVeinsResponse:
    """Every GT ore vein Visual Prospecting has cached for this dimension."""
    return await asyncio.to_thread(get_ore_veins, world_path)
