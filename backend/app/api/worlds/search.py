"""Block search endpoint — find where block types occur in a dimension."""

import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.models.search import SearchBlocksResponse
from app.services.search_service import find_blocks

router = APIRouter()


@router.get("/search-blocks", response_model=SearchBlocksResponse)
async def search_blocks(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    ids: str = Query(..., description="comma-separated block ids to find"),
    limit: int = Query(500, ge=1, le=5000, description="max matching chunks"),
) -> SearchBlocksResponse:
    try:
        block_ids = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers") from e
    if not block_ids:
        raise HTTPException(status_code=400, detail="no block ids provided")
    try:
        return await asyncio.to_thread(find_blocks, world_path, block_ids, limit)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
