import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.models.region import ChunkData, DimensionInfo, RegionDetail, RegionListResponse
from app.models.world import WorldValidateRequest, WorldValidateResponse
from app.services.block_color_service import (
    build_block_color_map,
    find_minecraft_dir,
)
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



@router.get("/block-colors")
async def get_block_colors(world_path: str = Query(...)) -> dict[int, list[int]]:
    try:
        return await asyncio.to_thread(build_block_color_map, world_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


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


@router.get("/chunks/{cx}/{cz}", response_model=ChunkData)
async def get_world_chunk(cx: int, cz: int, world_path: str = Query(...)) -> ChunkData:
    try:
        return get_chunk_data(world_path, cx, cz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
