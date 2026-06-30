"""Block colour / texture map and raw texture-serving endpoints."""

import asyncio
import base64
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models.world import TexturesBatchRequest
from app.services.blockcolor.scan_progress import get_scan_progress_tracker
from app.services.blockcolor.service import (
    build_block_color_map,
    build_block_meta_texture_map,
    build_block_texture_map,
)
from app.services.texture_service import get_textures_batch

router = APIRouter()

# Safety cap; the client chunks the preload well below this.
MAX_TEXTURE_BATCH = 4096

# Textures are immutable per key (a 'domain:name' always maps to the same bytes),
# so the webview may cache them forever — bump the `_v` query param to bust.
_TEXTURE_CACHE_CONTROL = "public, max-age=31536000, immutable"


@router.get("/scan-progress")
async def get_scan_progress(world_path: str = Query(...)) -> dict[str, object]:
    """Live mod-JAR scan progress for the loading screen.

    Cheap to call (reads an in-memory snapshot); poll it while the block-color
    map is still being built so the UI can show which mod is being scanned.
    """
    p = get_scan_progress_tracker().get(world_path)
    return {"total": p.total, "scanned": p.scanned, "current": p.current, "done": p.done}


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


@router.post("/textures-batch")
async def post_textures_batch(req: TexturesBatchRequest) -> dict[str, str]:
    """Return base64 data-URLs for many texture keys in one request.

    The initial preload needs hundreds of textures; fetching them as individual
    images saturates the webview's ~6-connection limit. Batching collapses that
    to a handful of requests and lets the backend open each source JAR once.
    Missing keys are omitted — the client treats an absent key as 'no texture'.
    """
    if len(req.keys) > MAX_TEXTURE_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Too many keys requested ({len(req.keys)} > {MAX_TEXTURE_BATCH})",
        )
    raw = await asyncio.to_thread(get_textures_batch, req.keys)
    out: dict[str, str] = {}
    for key, png in raw.items():
        if png is not None:
            out[key] = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return out


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
        headers={"Cache-Control": _TEXTURE_CACHE_CONTROL},
    )
