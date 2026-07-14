"""Block search endpoint — find where block types occur in a dimension."""

import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.models.search import (
    BiomePresence,
    ChunkStatCell,
    ChunkStatsResponse,
    SearchBlocksResponse,
)
from app.services.search_index import chunk_stats, ensure_index
from app.services.search_service import find_biomes, find_blocks, list_biomes

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


@router.get("/search-biomes", response_model=SearchBlocksResponse)
async def search_biomes(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    ids: str = Query(..., description="comma-separated biome ids to find"),
    limit: int = Query(500, ge=1, le=5000, description="max matching chunks"),
) -> SearchBlocksResponse:
    try:
        biome_ids = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers") from e
    if not biome_ids:
        raise HTTPException(status_code=400, detail="no biome ids provided")
    try:
        return await asyncio.to_thread(find_biomes, world_path, biome_ids, limit)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/biomes-present", response_model=list[BiomePresence])
async def biomes_present_route(
    world_path: str = Query(..., description="dimension path (contains region/)"),
) -> list[BiomePresence]:
    """The biomes that actually occur in this dimension, widest-area first."""
    try:
        return await asyncio.to_thread(list_biomes, world_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/chunk-stats", response_model=ChunkStatsResponse)
async def chunk_stats_route(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    metric: str = Query("variety", description="'variety' | 'density'"),
    ids: str = Query("", description="comma-separated block ids (for density)"),
) -> ChunkStatsResponse:
    block_ids = [int(x) for x in ids.split(",") if x.strip()] if ids else None

    def work() -> ChunkStatsResponse:
        ensure_index(world_path)
        cells = chunk_stats(world_path, metric, block_ids)
        vs = [c[2] for c in cells]
        return ChunkStatsResponse(
            metric=metric,
            cells=[ChunkStatCell(cx=c[0], cz=c[1], v=c[2]) for c in cells],
            vmin=min(vs) if vs else 0,
            vmax=max(vs) if vs else 0,
        )

    try:
        return await asyncio.to_thread(work)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
