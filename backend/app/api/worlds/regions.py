"""World metadata, region, and chunk endpoints."""

import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.models.region import (
    ChunkBatchRequest,
    ChunkBatchResponse,
    ChunkData,
    DimensionInfo,
    RegionDetail,
    RegionListResponse,
    RegionSurfaceResponse,
)
from app.models.world import (
    WorldValidateRequest,
    WorldValidateResponse,
)
from app.services.region_service import (
    get_chunk_data,
    get_chunks_batch,
    get_region_detail,
    get_region_surface,
    list_dimensions,
    list_regions,
)
from app.services.world_validator import validate_world_path

router = APIRouter()


# Upper bound on chunks served per bulk request, to cap response size and work.
MAX_BATCH_CHUNKS = 1024


@router.post("/validate", response_model=WorldValidateResponse)
async def validate_world(request: WorldValidateRequest) -> WorldValidateResponse:
    valid, error = validate_world_path(request.path)
    return WorldValidateResponse(valid=valid, error=error)


@router.get("/dimensions", response_model=list[DimensionInfo])
async def get_world_dimensions(world_path: str = Query(...)) -> list[DimensionInfo]:
    try:
        return list_dimensions(world_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/regions", response_model=RegionListResponse)
async def list_world_regions(world_path: str = Query(...)) -> RegionListResponse:
    try:
        return list_regions(world_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/regions/{rx}/{rz}", response_model=RegionDetail)
async def get_world_region(rx: int, rz: int, world_path: str = Query(...)) -> RegionDetail:
    try:
        return get_region_detail(world_path, rx, rz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/regions/{rx}/{rz}/surface", response_model=RegionSurfaceResponse)
async def get_world_region_surface(
    rx: int, rz: int, world_path: str = Query(...)
) -> RegionSurfaceResponse:
    """Compact per-column surface summary for one region (zoomed-out LOD tile)."""
    try:
        return await asyncio.to_thread(get_region_surface, world_path, rx, rz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/chunks/batch", response_model=ChunkBatchResponse)
async def get_world_chunks_batch(req: ChunkBatchRequest) -> ChunkBatchResponse:
    """Read many chunks in one request.

    Coords are grouped by region so each region file is read once.  Absent or
    empty chunks are omitted; the caller diffs request vs. response to mark
    them empty.  Parsing runs off the event loop so concurrent requests don't
    serialize on the single async thread.
    """
    if len(req.coords) > MAX_BATCH_CHUNKS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many chunks requested ({len(req.coords)} > {MAX_BATCH_CHUNKS})",
        )
    chunks = await asyncio.to_thread(get_chunks_batch, req.world_path, req.coords)
    return ChunkBatchResponse(chunks=chunks)


@router.get("/chunks/{cx}/{cz}", response_model=ChunkData)
async def get_world_chunk(cx: int, cz: int, world_path: str = Query(...)) -> ChunkData:
    try:
        return await asyncio.to_thread(get_chunk_data, world_path, cx, cz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
