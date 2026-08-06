"""Release process-local resources when a world is switched or closed."""

import asyncio

from fastapi import APIRouter, Query

from app.services.blockcolor.service import evict_block_color_service
from app.services.texture_service import clear_texture_cache

router = APIRouter()


def _release_world(world_path: str) -> None:
    scope = evict_block_color_service(world_path)
    if scope is not None:
        clear_texture_cache(scope)


@router.delete("/close", status_code=204)
async def close_world(world_path: str = Query(...)) -> None:
    """Evict derived maps and decoded texture bytes owned by a closed world."""
    await asyncio.to_thread(_release_world, world_path)
