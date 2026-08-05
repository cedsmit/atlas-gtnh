"""World-viewer API: assembles the per-feature routers under /worlds."""

from fastapi import APIRouter

from app.api.worlds import (
    bedrock_fluids,
    chunk_ops,
    debug,
    dump,
    ore_veins,
    overrides,
    regions,
    search,
    textures,
)

router = APIRouter(prefix="/worlds", tags=["worlds"])
router.include_router(regions.router)
router.include_router(textures.router)
router.include_router(dump.router)
router.include_router(debug.router)
router.include_router(chunk_ops.router)
router.include_router(overrides.router)
router.include_router(search.router)
router.include_router(ore_veins.router)
router.include_router(bedrock_fluids.router)
