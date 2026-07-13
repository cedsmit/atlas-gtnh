"""Authored render-rule overrides — Stage 2.3 (self-learning registry).

Maintainer authoring tool: persists accepted render rules into the shipped
``render-rules/authored.json`` (see ``services/user_overrides``) and serves them back
so the frontend can merge + re-render them live. End users have no debug tools, so
they never call these — a dev fix here ships to everyone on the next build.
"""

import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.models.world import RenderOverrideRequest
from app.services.user_overrides import (
    load_overrides,
    remove_override,
    upsert_override,
)

router = APIRouter()

_VALID_CATEGORIES = frozenset({"solid", "overlay", "fluid", "transparent", "partial", "ignore"})


@router.get("/render-overrides")
async def get_render_overrides() -> dict[str, object]:
    """The user's saved render-rule overrides (a RegistryJson the client merges)."""
    return await asyncio.to_thread(load_overrides)


@router.post("/render-overrides")
async def add_render_override(req: RenderOverrideRequest) -> dict[str, object]:
    """Add/replace a block's render override; persists it. Returns the full doc."""
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    if req.definition.get("category") not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"definition.category must be one of {sorted(_VALID_CATEGORIES)}",
        )
    return await asyncio.to_thread(upsert_override, req.name, req.definition)


@router.delete("/render-overrides")
async def delete_render_override(name: str = Query(...)) -> dict[str, object]:
    """Remove one block's override. Returns the full doc."""
    if not name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    return await asyncio.to_thread(remove_override, name)
