"""World-viewer API: assembles the per-feature routers under /worlds."""

from fastapi import APIRouter

from app.api.worlds import chunk_ops, debug, dump, regions, textures

router = APIRouter(prefix="/worlds", tags=["worlds"])
router.include_router(regions.router)
router.include_router(textures.router)
router.include_router(dump.router)
router.include_router(debug.router)
router.include_router(chunk_ops.router)
