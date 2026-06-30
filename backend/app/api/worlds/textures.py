"""Block colour / texture map and raw texture-serving endpoints."""

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.blockcolor.service import (
    build_block_color_map,
    build_block_meta_texture_map,
    build_block_texture_map,
)

router = APIRouter()


@router.get("/block-names")
async def get_block_names(world_path: str = Query(...)) -> dict[int, str]:
    from app.world.block_registry import read_block_id_map
    return read_block_id_map(Path(world_path))


@router.get("/block-colors")
async def get_block_colors(world_path: str = Query(...)) -> dict[int, list[int]]:
    try:
        return await asyncio.to_thread(build_block_color_map, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/block-texture-map")
async def get_block_texture_map(world_path: str = Query(...)) -> dict[int, str]:
    """Return block_id → texture_key for every block that has a matched texture.

    The texture_key is passed to /worlds/textures to fetch the PNG.
    Blocks without a texture are omitted; the frontend falls back to its own
    color table for those.
    """
    try:
        return await asyncio.to_thread(build_block_texture_map, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/block-meta-texture-map")
async def get_block_meta_texture_map(world_path: str = Query(...)) -> dict[str, str]:
    """Return '{block_id}:{meta}' → texture_key for meta-variant vanilla blocks.

    Covers wool, carpet, stained glass/pane, stained clay, planks, logs, leaves.
    The frontend checks this before falling back to the plain block-texture-map.
    """
    try:
        return await asyncio.to_thread(build_block_meta_texture_map, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/textures")
async def get_texture(key: str = Query(...)) -> Response:
    """Serve the raw PNG bytes for a texture key such as 'minecraft:stone'.

    The PNG is read directly from the scanned mod JAR; results are cached
    in-process.  Returns 404 when the texture was not found during scanning.
    """
    from app.services.texture_service import get_texture_png

    png = await asyncio.to_thread(get_texture_png, key)
    if png is None:
        raise HTTPException(status_code=404, detail=f"Texture not found: {key}")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )
