"""Block search endpoint — find where block types occur in a dimension."""

import asyncio
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Query

from app.models.search import (
    BiomePresence,
    ChunkStatCell,
    ChunkStatsResponse,
    SearchBlocksResponse,
)
from app.services import search_progress
from app.services.search_index import IndexBuildCancelled, chunk_stats, ensure_index
from app.services.search_service import find_biomes, find_blocks, list_biomes

router = APIRouter()


def _job_callbacks(
    job_id: str | None,
) -> tuple[Callable[[int, int], None] | None, Callable[[], bool] | None]:
    if not job_id:
        return None, None
    job = search_progress.start(job_id)
    return (
        lambda done, total: search_progress.update(job_id, done, total),
        job.cancel_event.is_set,
    )


@router.get("/search-index-progress")
async def search_index_progress(job_id: str = Query(...)) -> dict[str, int | str]:
    return search_progress.get(job_id) or {"done": 0, "total": 0, "state": "unknown"}


@router.delete("/search-index-progress")
async def cancel_search_index(job_id: str = Query(...)) -> dict[str, bool]:
    return {"cancelled": search_progress.cancel(job_id)}


@router.get("/search-blocks", response_model=SearchBlocksResponse)
async def search_blocks(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    ids: str = Query(..., description="comma-separated block ids to find"),
    limit: int = Query(500, ge=1, le=5000, description="max matching chunks"),
    job_id: str | None = Query(None, description="client id for progress/cancellation"),
) -> SearchBlocksResponse:
    try:
        block_ids = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers") from e
    if not block_ids:
        raise HTTPException(status_code=400, detail="no block ids provided")
    try:
        progress, cancelled = _job_callbacks(job_id)
        result = await asyncio.to_thread(
            find_blocks, world_path, block_ids, limit, progress, cancelled
        )
        if job_id:
            search_progress.finish(job_id)
        return result
    except IndexBuildCancelled as e:
        if job_id:
            search_progress.finish(job_id, "cancelled")
        raise HTTPException(status_code=409, detail="search cancelled") from e
    except FileNotFoundError as e:
        if job_id:
            search_progress.finish(job_id, "error")
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/search-biomes", response_model=SearchBlocksResponse)
async def search_biomes(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    ids: str = Query(..., description="comma-separated biome ids to find"),
    limit: int = Query(500, ge=1, le=5000, description="max matching chunks"),
    job_id: str | None = Query(None, description="client id for progress/cancellation"),
) -> SearchBlocksResponse:
    try:
        biome_ids = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers") from e
    if not biome_ids:
        raise HTTPException(status_code=400, detail="no biome ids provided")
    try:
        progress, cancelled = _job_callbacks(job_id)
        result = await asyncio.to_thread(
            find_biomes, world_path, biome_ids, limit, progress, cancelled
        )
        if job_id:
            search_progress.finish(job_id)
        return result
    except IndexBuildCancelled as e:
        if job_id:
            search_progress.finish(job_id, "cancelled")
        raise HTTPException(status_code=409, detail="search cancelled") from e
    except FileNotFoundError as e:
        if job_id:
            search_progress.finish(job_id, "error")
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/biomes-present", response_model=list[BiomePresence])
async def biomes_present_route(
    world_path: str = Query(..., description="dimension path (contains region/)"),
    job_id: str | None = Query(None, description="client id for progress/cancellation"),
) -> list[BiomePresence]:
    """The biomes that actually occur in this dimension, widest-area first."""
    try:
        progress, cancelled = _job_callbacks(job_id)
        result = await asyncio.to_thread(list_biomes, world_path, progress, cancelled)
        if job_id:
            search_progress.finish(job_id)
        return result
    except IndexBuildCancelled as e:
        if job_id:
            search_progress.finish(job_id, "cancelled")
        raise HTTPException(status_code=409, detail="search cancelled") from e
    except FileNotFoundError as e:
        if job_id:
            search_progress.finish(job_id, "error")
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
