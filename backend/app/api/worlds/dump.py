"""Forge icon-dump management and the missing-block report."""

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models.world import (
    LoadDumpRequest,
    MissingReportBody,
)
from app.services.blockcolor.diagnostics import (
    build_missing_block_report,
    compute_dump_mismatch,
    missing_block_report_csv,
)
from app.services.blockcolor.dump_resolver import get_dump_resolver, try_load_dump

router = APIRouter()


# Icon dumps are ~10-20 MB; cap well above that to reject junk without OOM risk.
_MAX_DUMP_BYTES = 128 * 1024 * 1024


@router.post("/load-dump")
async def load_dump_endpoint(request: LoadDumpRequest) -> dict[str, object]:
    """
    Load a Forge icon dump JSON file produced by the AtlasDumper mod.

    The dump is cached in memory for the lifetime of the Atlas process.
    Calling this again replaces any previously loaded dump.

    Body: { "path": "/absolute/path/to/icon_dump.json" }
    """
    p = Path(request.path).resolve()
    # Only accept a .json file of sane size — the endpoint takes a raw path and
    # the server has no auth, so don't let a caller point it at arbitrary files.
    if p.suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="Dump path must be a .json file")
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")
    if p.stat().st_size > _MAX_DUMP_BYTES:
        raise HTTPException(status_code=400, detail="Dump file is too large")

    ok = await asyncio.to_thread(try_load_dump, p)
    if not ok:
        raise HTTPException(
            status_code=422,
            detail="Failed to parse dump file — expected a valid atlas-gtnh-icon-dump-v1 JSON",
        )

    dump = get_dump_resolver()
    return {
        "loaded": dump.is_loaded,
        "path": dump.path,
        "block_count": dump.block_count,
        "summary": dump.summary,
    }


@router.get("/dump-status")
async def dump_status_endpoint() -> dict[str, object]:
    """Return the current Forge icon dump load status."""
    dump = get_dump_resolver()
    return {
        "loaded": dump.is_loaded,
        "path": dump.path,
        "block_count": dump.block_count,
        "summary": dump.summary,
    }


@router.get("/dump-mismatch")
async def dump_mismatch_endpoint(world_path: str = Query(...)) -> dict[str, object]:
    """Compare a world's FML mod list against the loaded icon dump.

    Reports mods present in the world but missing from the dump (with the
    number of blocks each contributes), version differences, and total-count
    differences — the usual cause of "no mapping" blocks.
    """
    try:
        return await asyncio.to_thread(compute_dump_mismatch, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/missing-block-report")
async def missing_block_report_endpoint(
    body: MissingReportBody,
    world_path: str = Query(...),
    fmt: str = Query("json", alias="format"),
) -> Response:
    """Generate a downloadable diagnostic of every world block missing from the dump.

    Body carries optional client on-map data (occurrences = columns rendered,
    metas = metadata values seen). Returns JSON (default) or CSV (?format=csv)
    as a file attachment.
    """
    try:
        report = await asyncio.to_thread(
            build_missing_block_report, world_path, body.occurrences, body.metas
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    if fmt == "csv":
        return Response(
            content=missing_block_report_csv(report),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="missing-blocks.csv"'},
        )
    return Response(
        content=json.dumps(report, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="missing-blocks.json"'},
    )
