import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from app.models.region import ChunkData, DimensionInfo, RegionDetail, RegionListResponse
from app.models.world import WorldValidateRequest, WorldValidateResponse
from app.services.block_color_service import (
    build_block_color_map,
    build_block_meta_texture_map,
    build_block_texture_map,
    compute_dump_mismatch,
    debug_pipeline_report,
    debug_texture_resolution,
    find_minecraft_dir,
    trace_block_pipeline,
)
from app.services.dump_resolver import get_dump_resolver, try_load_dump
from app.services.region_service import (
    get_chunk_data,
    get_region_detail,
    list_dimensions,
    list_regions,
)
from app.services.world_validator import validate_world_path

router = APIRouter(prefix="/worlds", tags=["worlds"])


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


@router.get("/debug-colors")
async def debug_colors(world_path: str = Query(...)) -> dict[str, object]:
    """Diagnostic endpoint — returns step-by-step info about why block colors may be empty."""
    import traceback

    from app.world.block_registry import read_block_id_map
    from app.world.texture_colors import collect_texture_colors

    path = Path(world_path)
    result: dict[str, object] = {"world_path": world_path}

    level_dat = path / "level.dat"
    result["level_dat_exists"] = level_dat.exists()

    try:
        id_map = read_block_id_map(path)
        result["block_id_count"] = len(id_map)
        result["sample_ids"] = dict(list(id_map.items())[:5])
    except Exception:
        result["block_id_error"] = traceback.format_exc()

    # Step into nbtlib directly so the silent except in read_block_id_map can't hide info
    try:
        from typing import Any

        import nbtlib

        nbt: Any = nbtlib.load(str(level_dat))
        result["nbt_root_keys"] = list(nbt.keys())
        data: Any = nbt.get("Data")
        result["nbt_data_keys"] = list(data.keys()) if data else None
        # Check FML at root level (some Forge builds put it outside Data)
        fml_root: Any = nbt.get("FML")
        result["has_fml_at_root"] = fml_root is not None
        fml: Any = (data.get("FML") if data else None) or fml_root
        result["has_fml"] = fml is not None
        if fml is not None:
            result["fml_keys"] = list(fml.keys())
            registries: Any = fml.get("Registries")
            result["has_registries"] = registries is not None
            if registries is not None:
                result["registry_keys"] = list(registries.keys())[:10]
                block_reg: Any = registries.get("minecraft:blocks")
                result["has_block_reg"] = block_reg is not None
                if block_reg is not None:
                    result["block_reg_keys"] = list(block_reg.keys())
                    ids: Any = block_reg.get("ids")
                    result["has_ids"] = ids is not None
                    if ids is not None:
                        result["ids_type"] = type(ids).__name__
                        result["ids_len"] = len(ids)
                        if len(ids) > 0:
                            result["ids_sample"] = str(ids[0])
    except Exception:
        result["nbt_parse_error"] = traceback.format_exc()

    # Check for alternative FML registry files in the world folder
    alt_files = []
    for f in path.iterdir():
        if f.is_file() and f.suffix in (".dat", ".dat_old", ".nbt"):
            alt_files.append(f.name)
    result["world_dat_files"] = sorted(alt_files)

    mc_dir = find_minecraft_dir(path)
    result["minecraft_dir"] = str(mc_dir) if mc_dir else None

    if mc_dir:
        mods_dir = mc_dir / "mods"
        result["mods_dir_exists"] = mods_dir.is_dir()
        if mods_dir.is_dir():
            jars = list(mods_dir.glob("**/*.jar"))
            result["jar_count"] = len(jars)
            result["sample_jars"] = [str(j.name) for j in jars[:5]]
        try:
            texture_colors = collect_texture_colors(mc_dir)
            result["texture_color_count"] = len(texture_colors)
            result["sample_textures"] = dict(list(texture_colors.items())[:5])
        except Exception:
            result["texture_error"] = traceback.format_exc()

    return result



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


@router.get("/debug-color-stats")
async def debug_color_stats(
    world_path: str = Query(...),
    rx: int = Query(0),
    rz: int = Query(0),
) -> dict[str, object]:
    """Scan one region and report how many top blocks resolve to texture colors vs fallback.

    Use this to identify which block IDs are causing the most fallback (hash) colors
    so they can be fixed with manual overrides or improved texture mapping.
    """
    from collections import Counter

    from app.world.block_registry import read_block_id_map
    from app.world.region_reader import read_chunk_data, read_region

    GRASS_TINTED: set[int] = {2, 31, 175}
    FOLIAGE_TINTED: set[int] = {18, 106, 111, 161, 1375, 1376}

    path = Path(world_path)
    region_file = path / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        return {"error": f"Region r.{rx}.{rz}.mca not found"}

    id_map = read_block_id_map(path)
    color_map = build_block_color_map(world_path)

    total = 0
    biome_tinted_count = 0
    texture_count = 0
    fallback_ids: Counter[int] = Counter()

    raw_chunks, _ = read_region(region_file)
    for chunk_meta in raw_chunks:
        try:
            raw = read_chunk_data(region_file, chunk_meta.local_x, chunk_meta.local_z)
            if not raw.sections:
                continue
            sections = sorted(raw.sections, key=lambda s: s.y, reverse=True)
            for z in range(16):
                for x in range(16):
                    top_id: int | None = None
                    for sec in sections:
                        if top_id is not None:
                            break
                        for y in range(15, -1, -1):
                            bid = sec.blocks[(y << 8) | (z << 4) | x]
                            if bid != 0:
                                top_id = bid
                                break
                    if top_id is None:
                        continue
                    total += 1
                    if top_id in GRASS_TINTED or top_id in FOLIAGE_TINTED:
                        biome_tinted_count += 1
                    elif top_id in color_map:
                        texture_count += 1
                    else:
                        fallback_ids[top_id] += 1
        except Exception:
            continue

    fallback_total = sum(fallback_ids.values())
    top_fallbacks = [
        {
            "id": bid,
            "count": cnt,
            "pct": round(cnt * 100 / total, 1) if total else 0,
            "registry_name": id_map.get(bid, "unknown"),
            "in_color_map": bid in color_map,
        }
        for bid, cnt in fallback_ids.most_common(30)
    ]

    return {
        "region": f"r.{rx}.{rz}",
        "total_columns": total,
        "resolved": biome_tinted_count + texture_count,
        "resolved_pct": round((biome_tinted_count + texture_count) * 100 / total, 1)
        if total
        else 0,
        "biome_tinted": biome_tinted_count,
        "texture_resolved": texture_count,
        "fallback": fallback_total,
        "fallback_pct": round(fallback_total * 100 / total, 1) if total else 0,
        "top_fallback_blocks": top_fallbacks,
    }


@router.get("/debug-top-blocks")
async def debug_top_blocks(cx: int, cz: int, world_path: str = Query(...)) -> dict[str, object]:
    """Return the top (visible-from-above) block ID at every x,z in a chunk.

    Useful for identifying which modded block IDs are dominating a map tile.
    Response includes a frequency table so the most common blocks are obvious.
    """
    from collections import Counter

    from app.world.block_registry import read_block_id_map
    from app.world.region_reader import read_chunk_data

    rx, rz = cx >> 5, cz >> 5
    lx, lz = cx % 32, cz % 32
    region_file = Path(world_path) / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        return {"error": "region file not found"}

    raw = read_chunk_data(region_file, lx, lz)
    if not raw.sections:
        return {"error": "chunk has no sections"}

    id_map = read_block_id_map(Path(world_path))
    color_map = build_block_color_map(world_path)

    sections = sorted(raw.sections, key=lambda s: s.y, reverse=True)
    top_blocks: list[dict[str, object]] = []
    freq: Counter[int] = Counter()

    for z in range(16):
        for x in range(16):
            found_id: int | None = None
            for sec in sections:
                if found_id is not None:
                    break
                for y in range(15, -1, -1):
                    idx = (y << 8) | (z << 4) | x
                    bid = sec.blocks[idx]
                    if bid != 0:
                        found_id = bid
                        break
            if found_id is not None:
                freq[found_id] += 1

    top_blocks = [
        {
            "block_id": bid,
            "count": cnt,
            "registry_name": id_map.get(bid, "unknown"),
            "has_color": bid in color_map,
        }
        for bid, cnt in freq.most_common(30)
    ]

    return {
        "cx": cx, "cz": cz,
        "top_blocks": top_blocks,
    }


@router.get("/debug-chunk")
async def debug_chunk_nbt(cx: int, cz: int, world_path: str = Query(...)) -> dict[str, object]:
    """Dump raw NBT info for a chunk — use this to diagnose missing terrain data."""
    import io
    import struct

    import nbtlib

    from app.world.region_reader import _decompress_chunk

    rx = cx >> 5
    rz = cz >> 5
    lx = cx % 32
    lz = cz % 32
    region_file = Path(world_path) / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        return {"error": "region file not found", "path": str(region_file)}

    data = region_file.read_bytes()
    idx = lz * 32 + lx
    loc = idx * 4
    raw_loc = struct.unpack(">I", data[loc : loc + 4])[0]
    offset = raw_loc >> 8
    if offset == 0:
        return {"error": "chunk not in region location table", "cx": cx, "cz": cz}

    try:
        raw_nbt = _decompress_chunk(data, offset)
    except Exception as exc:
        return {"error": f"decompression failed: {exc}"}

    try:
        nbt_file = nbtlib.File.parse(io.BytesIO(raw_nbt))
        level = nbt_file["Level"]
    except Exception as exc:
        return {"error": f"NBT parse failed: {exc}"}

    sections_tag = level.get("Sections")
    result: dict[str, object] = {
        "cx": cx, "cz": cz, "rx": rx, "rz": rz, "lx": lx, "lz": lz,
        "level_keys": sorted(level.keys()),
        "has_sections": sections_tag is not None,
        "sections_count": len(sections_tag) if sections_tag else 0,
        "terrain_populated": int(level.get("TerrainPopulated", 0)),
    }
    if sections_tag:
        s0 = sections_tag[0]  # inspect first section only — enough to determine format
        blocks_tag = s0.get("Blocks")
        blocks16_tag = s0.get("Blocks16")
        data_tag = s0.get("Data")
        data16_tag = s0.get("Data16")
        result["section_0_keys"] = sorted(s0.keys())
        result["blocks_tag_type"] = type(blocks_tag).__name__ if blocks_tag is not None else None
        result["blocks_len"] = len(blocks_tag) if blocks_tag is not None else None
        result["blocks16_tag_type"] = (
            type(blocks16_tag).__name__ if blocks16_tag is not None else None
        )
        result["blocks16_len"] = len(blocks16_tag) if blocks16_tag is not None else None
        result["blocks16_sample"] = (
            [int(b) for b in blocks16_tag[:8]] if blocks16_tag is not None else None
        )
        result["data_tag_type"] = type(data_tag).__name__ if data_tag is not None else None
        result["data_len"] = len(data_tag) if data_tag is not None else None
        result["data16_tag_type"] = type(data16_tag).__name__ if data16_tag is not None else None
        result["data16_len"] = len(data16_tag) if data16_tag is not None else None
    return result


@router.get("/debug-texture-grid", response_class=HTMLResponse)
async def debug_texture_grid(world_path: str = Query(...)) -> HTMLResponse:
    """Visual HTML page showing every block's resolved color swatch.

    Open in a browser to verify that texture colors look correct.
    Blocks with a texture-derived color get a green badge; fallbacks get orange.
    """
    from app.world.block_registry import read_block_id_map

    id_map = read_block_id_map(Path(world_path))
    color_map = build_block_color_map(world_path)

    # Build rows: resolved blocks first, then fallbacks, both sorted by ID
    resolved_rows: list[tuple[int, str, tuple[int, int, int], bool]] = []
    fallback_rows: list[tuple[int, str, tuple[int, int, int], bool]] = []

    for bid, name in sorted(id_map.items()):
        if bid in color_map:
            rgb = tuple(color_map[bid])  # type: ignore[arg-type]
            resolved_rows.append((bid, name, rgb, True))  # type: ignore[arg-type]
        else:
            # Simple hash fallback — same formula as frontend blockColorRGB
            hue = ((bid * 137) % 360 + 360) % 360
            # Convert HSL(hue, 0.55, 0.45) to approximate RGB for preview
            h = hue / 60
            c = (1 - abs(2 * 0.45 - 1)) * 0.55
            x = c * (1 - abs(h % 2 - 1))
            m = 0.45 - c / 2
            if h < 1:
                r, g, b = c, x, 0
            elif h < 2:
                r, g, b = x, c, 0
            elif h < 3:
                r, g, b = 0, c, x
            elif h < 4:
                r, g, b = 0, x, c
            elif h < 5:
                r, g, b = x, 0, c
            else:
                r, g, b = c, 0, x
            rgb_fb = (int((r + m) * 255), int((g + m) * 255), int((b + m) * 255))
            fallback_rows.append((bid, name, rgb_fb, False))

    def swatch(bid: int, name: str, rgb: tuple[int, int, int], has_texture: bool) -> str:
        hex_col = "#{:02x}{:02x}{:02x}".format(*rgb)
        _bs = "padding:1px 5px;border-radius:3px;font-size:10px"
        badge_style_ok = f"background:#2a6;color:#fff;{_bs}"
        badge_style_fb = f"background:#a62;color:#fff;{_bs}"
        badge = (
            f'<span style="{badge_style_ok}">texture</span>'
            if has_texture
            else f'<span style="{badge_style_fb}">fallback</span>'
        )
        return (
            f'<div style="display:flex;align-items:center;gap:8px;padding:3px 6px;'
            f'border-bottom:1px solid #222">'
            f'<div style="width:24px;height:24px;background:{hex_col};'
            f'border:1px solid #444;flex-shrink:0"></div>'
            f'<span style="color:#aaa;width:50px;flex-shrink:0">{bid}</span>'
            f'<span style="color:#ddd;flex:1;font-size:11px">{name}</span>'
            f'<span style="color:#888;width:60px;font-size:11px">{hex_col}</span>'
            f'{badge}'
            f"</div>"
        )

    rows_html = "\n".join(
        swatch(bid, name, rgb, tex) for bid, name, rgb, tex in resolved_rows + fallback_rows
    )
    texture_count = len(resolved_rows)
    fallback_count = len(fallback_rows)
    total = texture_count + fallback_count

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Atlas GTNH — Block Color Grid</title>
  <style>
    body {{ background:#111; color:#ccc; font-family:monospace; margin:0; padding:12px; }}
    h1 {{ color:#fff; margin:0 0 4px }}
    .stats {{ color:#888; margin-bottom:12px; font-size:13px }}
    .filter {{ margin-bottom:8px }}
    input {{ background:#222; color:#ccc; border:1px solid #444; padding:4px 8px;
             border-radius:4px; font-family:monospace; width:300px }}
    #grid {{ max-width:700px }}
  </style>
</head>
<body>
  <h1>Block Color Grid</h1>
  <div class="stats">
    {total} blocks &nbsp;|&nbsp;
    <span style="color:#4c4">{texture_count} texture-resolved</span> &nbsp;|&nbsp;
    <span style="color:#c84">{fallback_count} fallback</span> &nbsp;|&nbsp;
    {round(texture_count * 100 / total, 1) if total else 0}% resolved
  </div>
  <div class="filter">
    <input id="q" type="text" placeholder="filter by name or id..." oninput="filterRows()">
  </div>
  <div id="grid">{rows_html}</div>
  <script>
    const rows = document.querySelectorAll('#grid > div');
    function filterRows() {{
      const q = document.getElementById('q').value.toLowerCase();
      rows.forEach(r => {{
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
      }});
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)


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


@router.get("/pipeline-report")
async def pipeline_report_endpoint(world_path: str = Query(...)) -> dict[str, object]:
    """
    Run the blockstate → model → texture pipeline for every block in this world
    and return a categorized failure report.

    Blocks are resolved via JARs' assets/{domain}/blockstates/ and models/block/ JSON files.
    Failure categories tell you exactly where in the chain each block failed.
    This is slow on first call (scans all JARs for JSON assets) but cached afterwards.
    """
    try:
        return await asyncio.to_thread(debug_pipeline_report, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/pipeline-trace")
async def pipeline_trace_endpoint(
    world_path: str = Query(...),
    registry_name: str = Query(...),
    meta: int = Query(0),
) -> dict[str, object]:
    """
    Trace the blockstate resolution pipeline step-by-step for a single block.

    Returns a list of (ok, description) trace steps showing exactly where
    resolution succeeded or failed for the given registry_name + meta value.
    """
    try:
        return await asyncio.to_thread(trace_block_pipeline, world_path, registry_name, meta)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


class LoadDumpRequest(BaseModel):
    path: str  # Absolute path to icon_dump.json


@router.post("/load-dump")
async def load_dump_endpoint(request: LoadDumpRequest) -> dict[str, object]:
    """
    Load a Forge icon dump JSON file produced by the AtlasDumper mod.

    The dump is cached in memory for the lifetime of the Atlas process.
    Calling this again replaces any previously loaded dump.

    Body: { "path": "/absolute/path/to/icon_dump.json" }
    """
    p = Path(request.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"Not a file: {request.path}")

    ok = await asyncio.to_thread(try_load_dump, p)
    if not ok:
        raise HTTPException(status_code=422, detail="Failed to parse dump file — check that it is a valid atlas-gtnh-icon-dump-v1 JSON")

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


@router.get("/debug-texture-resolution")
async def debug_texture_resolution_endpoint(world_path: str = Query(...)) -> dict[str, object]:
    """Trace the full texture-resolution chain for every block in this world.

    Returns which JARs were found, which texture keys are present in scanned colors,
    and per-block resolution status (jar / fallback / none).  Open in the browser
    or call from the debug panel to diagnose 'no-mapping' blocks.
    """
    try:
        return await asyncio.to_thread(debug_texture_resolution, world_path)
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


@router.get("/chunks/{cx}/{cz}", response_model=ChunkData)
async def get_world_chunk(cx: int, cz: int, world_path: str = Query(...)) -> ChunkData:
    try:
        return get_chunk_data(world_path, cx, cz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
