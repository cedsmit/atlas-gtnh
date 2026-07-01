"""Chunk copy / delete-for-regeneration endpoints.

These WRITE to save files, so the world must be closed in Minecraft (the client
warns the user). Work runs off the event loop; region_writer backs up and writes
atomically.
"""

import asyncio

from fastapi import APIRouter, HTTPException

from app.models.region import CopyChunksRequest, DeleteChunksRequest
from app.services.chunk_ops_service import copy_chunks, delete_chunks

router = APIRouter()

MAX_CHUNKS = 100_000  # sanity cap on a single request


@router.post("/chunks/delete")
async def post_delete_chunks(req: DeleteChunksRequest) -> dict[str, object]:
    """Delete chunks so Minecraft regenerates them (with GT worldgen) on next load."""
    if len(req.chunks) > MAX_CHUNKS:
        raise HTTPException(
            status_code=400, detail=f"Too many chunks ({len(req.chunks)} > {MAX_CHUNKS})"
        )
    try:
        return await asyncio.to_thread(delete_chunks, req.world_path, req.chunks)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/chunks/copy")
async def post_copy_chunks(req: CopyChunksRequest) -> dict[str, object]:
    """Copy chunks from one save to another at the same coordinates (byte-exact)."""
    if len(req.chunks) > MAX_CHUNKS:
        raise HTTPException(
            status_code=400, detail=f"Too many chunks ({len(req.chunks)} > {MAX_CHUNKS})"
        )
    try:
        return await asyncio.to_thread(copy_chunks, req.src_world, req.dst_world, req.chunks)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
