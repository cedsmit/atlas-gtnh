"""Diagnostic / debug endpoints for the resolution pipeline."""

import asyncio
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse

from app.services.blockcolor.diagnostics import (
    debug_pipeline_report,
    debug_texture_resolution,
    trace_block_pipeline,
)
from app.services.blockcolor.resolution import find_minecraft_dir
from app.services.blockcolor.service import (
    build_block_color_map,
    build_block_texture_map,
)

router = APIRouter()


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
        "cx": cx,
        "cz": cz,
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
        "cx": cx,
        "cz": cz,
        "rx": rx,
        "rz": rz,
        "lx": lx,
        "lz": lz,
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
    texture_map = build_block_texture_map(world_path)  # block_id -> texture key (PNG)

    # Build rows: resolved blocks first, then fallbacks, both sorted by ID
    resolved_rows: list[tuple[int, str, tuple[int, int, int], bool]] = []
    fallback_rows: list[tuple[int, str, tuple[int, int, int], bool]] = []

    for bid, name in sorted(id_map.items()):
        if bid in color_map:
            rgb = tuple(color_map[bid])
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
                r, g, b = c, x, 0.0
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

    texture_count = len(resolved_rows)
    fallback_count = len(fallback_rows)
    total = texture_count + fallback_count
    pct = round(texture_count * 100 / total, 1) if total else 0

    def _namespace(nm: str) -> str:
        return nm.split(":", 1)[0] if ":" in nm else "(none)"

    # Mod/namespace dropdown options, sorted by block count (desc) then name.
    ns_counts: dict[str, int] = {}
    for nm in id_map.values():
        ns_counts[_namespace(nm)] = ns_counts.get(_namespace(nm), 0) + 1
    mod_options = f'<option value="">All mods ({total})</option>' + "".join(
        f'<option value="{ns}">{ns} ({c})</option>'
        for ns, c in sorted(ns_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    )

    def row_html(bid: int, name: str, rgb: tuple[int, int, int], has_texture: bool) -> str:
        hex_col = "#{:02x}{:02x}{:02x}".format(*rgb)
        r, g, b = rgb
        badge = (
            '<span class="badge ok">texture</span>'
            if has_texture
            else '<span class="badge fb">fallback</span>'
        )
        # data-f: lowercased searchable text; data-name: copied to clipboard on click;
        # data-tex: texture key for the hover preview (absent when the block has no PNG).
        tex_key = texture_map.get(bid)
        tex_attr = f' data-tex="{tex_key}"' if tex_key else ""
        if tex_key:
            sw_cell = (
                f'<img class="sw thumb" loading="lazy" alt="" '
                f'src="/worlds/textures?key={quote(tex_key, safe="")}">'
            )
        else:
            sw_cell = f'<div class="sw" style="background:{hex_col}"></div>'
        return (
            f'<div class="row" data-f="{bid} {name.lower()} {hex_col}" data-name="{name}" '
            f'data-id="{bid}" data-hex="{hex_col}" data-mod="{_namespace(name)}"{tex_attr} '
            f'title="rgb({r}, {g}, {b}) — click to copy name">'
            f"{sw_cell}"
            f'<span class="id">{bid}</span>'
            f'<span class="nm">{name}</span>'
            f'<span class="hex">{hex_col}</span>'
            f"{badge}"
            f"</div>"
        )

    def section(title: str, rows: list[tuple[int, str, tuple[int, int, int], bool]]) -> str:
        head = (
            '<div class="head"><span></span><span class="id">ID</span>'
            '<span>Name</span><span class="hex">Hex</span><span>Source</span></div>'
        )
        body = "\n".join(row_html(*r) for r in rows)
        return (
            "<details open data-section>"
            f'<summary><span class="arrow">▶</span>{title}'
            '<button class="copyall" title="Copy all block names in this section '
            'to the clipboard (respects the filter)">copy all</button>'
            f'<span class="count" data-total="{len(rows)}">{len(rows)}</span></summary>'
            f'{head}<div class="rows">{body}</div>'
            "</details>"
        )

    sections_html = section("Texture-resolved", resolved_rows) + section("Fallback", fallback_rows)

    template = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Atlas GTNH — Block Color Grid</title>
<style>
  * { box-sizing:border-box; }
  body { background:#111; color:#ccc; margin:0;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .toolbar { position:sticky; top:0; z-index:10; background:#111; border-bottom:1px solid #333; }
  .bar { max-width:860px; margin:0 auto; padding:14px 16px; }
  h1 { color:#fff; margin:0 0 6px; font-size:18px; }
  .stats { color:#888; font-size:13px; }
  .chip-ok { color:#5c5; } .chip-fb { color:#d95; }
  .controls { margin-top:10px; display:flex; gap:8px; align-items:center; }
  input#q { flex:1; max-width:360px; background:#1c1c1c; color:#ddd; border:1px solid #444;
            padding:6px 10px; border-radius:6px; font-family:inherit; font-size:13px; }
  .controls select { background:#1c1c1c; color:#ddd; border:1px solid #444; border-radius:6px;
                     padding:6px 8px; font-family:inherit; font-size:12px; cursor:pointer; }
  .btn { background:#222; color:#bbb; border:1px solid #444; padding:6px 12px; border-radius:6px;
         cursor:pointer; font-family:inherit; font-size:12px; }
  .btn:hover { background:#2a2a2a; color:#fff; }
  .wrap { max-width:860px; margin:0 auto; padding:0 16px 48px; }
  details { margin-top:14px; }
  summary { cursor:pointer; list-style:none; user-select:none; display:flex; align-items:center;
            gap:8px; padding:8px 12px; background:#1a1a1a; border:1px solid #333; border-radius:6px;
            color:#eee; font-size:13px; font-weight:600; }
  summary::-webkit-details-marker { display:none; }
  .arrow { color:#888; transition:transform .15s; font-size:10px; }
  details[open] .arrow { transform:rotate(90deg); }
  .copyall { margin-left:auto; background:#222; color:#bbb; border:1px solid #444;
             border-radius:5px; padding:2px 9px; font-family:inherit; font-size:11px;
             cursor:pointer; }
  .copyall:hover { background:#2a2a2a; color:#fff; }
  .count { margin-left:8px; color:#888; font-weight:400; font-size:12px;
           background:#111; border:1px solid #333; border-radius:10px; padding:0 8px; }
  .head, .row { display:grid; grid-template-columns:26px 52px 1fr 92px 74px; align-items:center;
                gap:12px; padding:4px 12px; }
  .head { color:#666; font-size:10px; text-transform:uppercase; letter-spacing:.06em;
          border-bottom:1px solid #333; }
  .rows .row { border-bottom:1px solid #1c1c1c; cursor:pointer; }
  .rows .row:nth-child(odd) { background:#151515; }
  .rows .row:hover { background:#242424; }
  .sw { width:22px; height:22px; border:1px solid #555; border-radius:3px; }
  img.thumb { image-rendering:pixelated; object-fit:cover; }
  .id { color:#999; text-align:right; }
  .nm { color:#e0e0e0; font-size:12px; overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; }
  .hex { color:#888; font-size:12px; text-align:right; }
  .badge { font-size:10px; padding:2px 0; border-radius:3px; text-align:center; color:#fff; }
  .badge.ok { background:#2a6; } .badge.fb { background:#a62; }
  #toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:#2a6;
           color:#fff; padding:7px 14px; border-radius:6px; font-size:12px; opacity:0;
           pointer-events:none; transition:opacity .2s; }
  #toast.show { opacity:1; }
  #preview { position:fixed; top:50%; right:max(16px, calc(25vw - 375px));
             transform:translateY(-50%); width:320px; text-align:center; z-index:5;
             pointer-events:none; }
  #pv-box { width:320px; height:320px; margin:0 auto; display:flex; align-items:center;
            justify-content:center; }
  #pv-img { width:320px; height:320px; image-rendering:pixelated; display:none; }
  #pv-none { color:#666; font-size:13px; }
  #pv-sw { height:16px; margin:10px 0 0; border:1px solid #333; border-radius:3px; }
  #pv-name { color:#eee; font-size:13px; margin-top:10px; word-break:break-all; }
  #pv-meta { color:#888; font-size:11px; margin-top:3px; word-break:break-all; }
  @media (max-width:1200px) { #preview { display:none; } }
</style>
</head>
<body>
  <div class="toolbar"><div class="bar">
    <h1>Block Color Grid</h1>
    <div class="stats">__TOTAL__ blocks &nbsp;·&nbsp;
      <span class="chip-ok">__TEX__ texture</span> &nbsp;·&nbsp;
      <span class="chip-fb">__FB__ fallback</span> &nbsp;·&nbsp; __PCT__% resolved</div>
    <div class="controls">
      <input id="q" type="text" placeholder="filter by name or id…" autofocus>
      <select id="mod" title="Filter by mod / namespace">__MOD_OPTIONS__</select>
      <select id="show" title="Filter by texture presence">
        <option value="all">All</option>
        <option value="tex">With texture</option>
        <option value="notex">No texture</option>
      </select>
      <button class="btn" id="toggleAll">Collapse all</button>
    </div>
  </div></div>
  <div class="wrap" id="wrap">__SECTIONS__</div>
  <div id="preview">
    <div id="pv-box"><img id="pv-img" alt=""><span id="pv-none">hover a block</span></div>
    <div id="pv-sw"></div>
    <div id="pv-name">—</div>
    <div id="pv-meta"></div>
  </div>
  <div id="toast"></div>
  <script>
    const q = document.getElementById('q');
    const toast = document.getElementById('toast');
    let toastT;
    function showToast(msg) {
      toast.textContent = msg; toast.classList.add('show');
      clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 1200);
    }
    const modSel = document.getElementById('mod');
    const showSel = document.getElementById('show');
    function filterRows() {
      const term = q.value.trim().toLowerCase();
      const mod = modSel.value;
      const show = showSel.value;
      const active = term || mod || show !== 'all';
      document.querySelectorAll('details[data-section]').forEach(det => {
        let shown = 0;
        det.querySelectorAll('.row').forEach(r => {
          const hasTex = r.dataset.tex !== undefined;
          const match = (!term || r.dataset.f.includes(term))
            && (!mod || r.dataset.mod === mod)
            && (show === 'all' || (show === 'tex') === hasTex);
          r.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        const c = det.querySelector('.count');
        c.textContent = active ? shown + ' / ' + c.dataset.total : c.dataset.total;
        if (active) det.open = shown > 0;
      });
    }
    q.addEventListener('input', filterRows);
    modSel.addEventListener('change', filterRows);
    showSel.addEventListener('change', filterRows);

    // Hover preview: show the block's real texture (or its swatch when it has none).
    const pvImg = document.getElementById('pv-img');
    const pvNone = document.getElementById('pv-none');
    const pvSw = document.getElementById('pv-sw');
    const pvName = document.getElementById('pv-name');
    const pvMeta = document.getElementById('pv-meta');
    pvImg.addEventListener('error', () => {
      pvImg.style.display = 'none';
      pvNone.textContent = 'texture unavailable'; pvNone.style.display = '';
    });
    document.getElementById('wrap').addEventListener('mouseover', e => {
      const row = e.target.closest('.row');
      if (!row) return;
      pvSw.style.background = row.dataset.hex || 'transparent';
      pvName.textContent = row.dataset.name;
      const tex = row.dataset.tex;
      if (tex) {
        pvMeta.textContent = 'id ' + row.dataset.id + ' · ' + tex;
        pvNone.style.display = 'none';
        pvImg.style.display = 'block';
        pvImg.src = '/worlds/textures?key=' + encodeURIComponent(tex);
      } else {
        pvImg.removeAttribute('src');
        pvImg.style.display = 'none';
        pvNone.textContent = 'no texture';
        pvNone.style.display = '';
        pvMeta.textContent = 'id ' + row.dataset.id;
      }
    });

    document.getElementById('wrap').addEventListener('click', e => {
      const copyAll = e.target.closest('.copyall');
      if (copyAll) {
        e.preventDefault(); e.stopPropagation();
        const det = copyAll.closest('details');
        const names = [...det.querySelectorAll('.row')]
          .filter(r => r.style.display !== 'none')
          .map(r => r.dataset.name);
        navigator.clipboard.writeText(names.join('\\n'))
          .then(() => showToast('Copied ' + names.length + ' names'));
        return;
      }
      const row = e.target.closest('.row');
      if (!row) return;
      navigator.clipboard.writeText(row.dataset.name)
        .then(() => showToast('Copied: ' + row.dataset.name));
    });
    const toggle = document.getElementById('toggleAll');
    toggle.addEventListener('click', () => {
      const dets = [...document.querySelectorAll('details[data-section]')];
      const anyClosed = dets.some(d => !d.open);
      dets.forEach(d => d.open = anyClosed);
      toggle.textContent = anyClosed ? 'Collapse all' : 'Expand all';
    });
  </script>
</body>
</html>"""

    html = (
        template.replace("__TOTAL__", str(total))
        .replace("__TEX__", str(texture_count))
        .replace("__FB__", str(fallback_count))
        .replace("__PCT__", str(pct))
        .replace("__MOD_OPTIONS__", mod_options)
        .replace("__SECTIONS__", sections_html)
    )
    return HTMLResponse(content=html)


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
