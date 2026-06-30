"""Diagnostic and report functions for the block texture-resolution pipeline.

Stateless consumers of the resolution helpers and the per-world service; used by
the debug / missing-block-report endpoints.
"""

from pathlib import Path

from app.services.block_color_resolution import (
    _collect_jars,
    _resolve_texture_key,
    _resolve_unified,
    _try_auto_load_dump,
    find_minecraft_dir,
)
from app.services.block_color_service import get_block_color_service
from app.services.blockstate_resolver import resolve_block_texture
from app.services.color_cache import load_jar_colors, save_jar_colors
from app.services.dump_resolver import get_dump_resolver, resolve_db_key
from app.services.legacy_resolver import resolve_legacy_texture
from app.services.vanilla_tables import _OVERRIDES, _VANILLA_TEXTURE_KEYS
from app.world.block_registry import read_block_id_map, read_world_modlist
from app.world.texture_colors import scan_jar


def debug_pipeline_report(world_path: str) -> dict[str, object]:
    """
    Run the full three-stage resolution pipeline (override → modern → legacy)
    for every block in this world and return a categorised report.

    Legacy blocks are tagged with confidence/ambiguity in block_methods:
      "legacy_high", "legacy_medium", "legacy_low",
      "legacy_high_ambiguous", "legacy_medium_ambiguous", "legacy_low_ambiguous"

    The 'categories' dict shows the modern pipeline failure reason for blocks
    that STILL couldn't be resolved after the legacy resolver also ran.
    """
    from collections import Counter, defaultdict

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        return {"error": "No block ID map found in world"}

    db = get_block_color_service(world_path).asset_db()

    override_count = 0
    forge_dump_count = 0
    forge_dump_ambiguous_count = 0
    modern_count = 0
    legacy_high_count = 0
    legacy_medium_count = 0
    legacy_low_count = 0
    legacy_ambiguous_count = 0
    none_count = 0
    failure_counts: Counter[str] = Counter()
    failure_examples: dict[str, list[str]] = defaultdict(list)
    legacy_examples: dict[str, list[str]] = defaultdict(list)
    block_methods: dict[str, str] = {}  # JSON-serialised block_id → method tag

    dump = get_dump_resolver()

    for block_id, registry_name in sorted(id_map.items()):
        norm_name = registry_name.lower()

        # Stage 1: override
        override = _OVERRIDES.get(norm_name)
        if override and override in db.texture_colors:
            override_count += 1
            block_methods[str(block_id)] = "override"
            continue

        # Stage 2: Forge icon dump
        if dump.is_loaded:
            dr = dump.resolve(registry_name, 0)
            if dr.resolved and dr.texture_key:
                tex_key = resolve_db_key(dr.texture_key, db.texture_colors)
                if tex_key is not None:
                    tag = "forge_dump_ambiguous" if dr.is_ambiguous else "forge_dump"
                    block_methods[str(block_id)] = tag
                    if dr.is_ambiguous:
                        forge_dump_ambiguous_count += 1
                    else:
                        forge_dump_count += 1
                    continue

        # Stage 3: modern blockstate pipeline
        modern = resolve_block_texture(registry_name, 0, db)
        if modern.resolved:
            modern_count += 1
            block_methods[str(block_id)] = "modern"
            continue

        # Stage 4: legacy naming-convention resolver
        legacy = resolve_legacy_texture(registry_name, db.texture_colors, 0)
        if legacy.resolved:
            tag = legacy.method_tag  # e.g. "legacy_high", "legacy_low_ambiguous"
            block_methods[str(block_id)] = tag
            if legacy.is_ambiguous:
                legacy_ambiguous_count += 1
            if legacy.confidence == "high":
                legacy_high_count += 1
            elif legacy.confidence == "medium":
                legacy_medium_count += 1
            else:
                legacy_low_count += 1
            if len(legacy_examples[tag]) < 6:
                key_note = f" → {legacy.texture_key}"
                legacy_examples[tag].append(f"[{block_id}] {registry_name}{key_note}")
            continue

        none_count += 1
        block_methods[str(block_id)] = "none"
        cat = modern.failure_reason or "unknown"
        failure_counts[cat] += 1
        if len(failure_examples[cat]) < 8:
            failure_examples[cat].append(f"[{block_id}] {registry_name}")

    total = len(id_map)
    legacy_count = legacy_high_count + legacy_medium_count + legacy_low_count
    forge_dump_total = forge_dump_count + forge_dump_ambiguous_count
    resolved = override_count + forge_dump_total + modern_count + legacy_count
    return {
        "total": total,
        "pipeline_resolved": resolved,
        "pipeline_unresolved": none_count,
        "override_resolved": override_count,
        "forge_dump_resolved": forge_dump_count,
        "forge_dump_ambiguous": forge_dump_ambiguous_count,
        "forge_dump_loaded": dump.is_loaded,
        "forge_dump_path": dump.path,
        "forge_dump_block_count": dump.block_count,
        "modern_resolved": modern_count,
        "legacy_resolved": legacy_count,
        "legacy_high": legacy_high_count,
        "legacy_medium": legacy_medium_count,
        "legacy_low": legacy_low_count,
        "legacy_ambiguous": legacy_ambiguous_count,
        "blockstate_count": len(db.blockstates),
        "model_count": len(db.models),
        "texture_color_count": len(db.texture_colors),
        "categories": dict(failure_counts.most_common()),
        "examples": dict(failure_examples),
        "legacy_examples": dict(legacy_examples),
        "block_methods": block_methods,
    }


def trace_block_pipeline(world_path: str, registry_name: str, meta: int) -> dict[str, object]:
    """
    Trace all three pipeline stages for a single block.

    Returns step-by-step audit trail showing exactly which stage resolved the block
    (or why all three stages failed).  The 'method' field is one of:
    'override', 'modern', 'legacy', or 'none'.
    """
    db = get_block_color_service(world_path).asset_db()
    trace: list[dict[str, object]] = []

    norm_name = registry_name.lower()

    # Stage 1: override
    override = _OVERRIDES.get(norm_name)
    if override:
        in_db = override in db.texture_colors
        status_note = "found" if in_db else "key not in texture DB"
        step = f"Override table: {norm_name!r} → {override!r} ({status_note})"
        trace.append({"ok": in_db, "step": step})
        if in_db:
            return {
                "registry_name": registry_name,
                "meta": meta,
                "resolved": True,
                "method": "override",
                "texture_key": override,
                "failure_reason": "",
                "trace": trace,
            }
    else:
        trace.append({"ok": True, "step": f"Override table: no entry for {norm_name!r}"})

    # Stage 2: Forge icon dump
    dump = get_dump_resolver()
    if dump.is_loaded:
        dr = dump.resolve(registry_name, meta)
        for msg in dr.trace:
            trace.append({"ok": dr.resolved, "step": f"Forge dump: {msg}"})
        if dr.resolved and dr.texture_key:
            tex_key = resolve_db_key(dr.texture_key, db.texture_colors)
            if tex_key is not None:
                method = "forge_dump_ambiguous" if dr.is_ambiguous else "forge_dump"
                trace.append({"ok": True, "step": (
                    f"Forge dump: icon {dr.texture_key!r} → {tex_key!r} "
                    f"found in texture DB (side {dr.side_used})"
                )})
                return {
                    "registry_name": registry_name,
                    "meta": meta,
                    "resolved": True,
                    "method": method,
                    "texture_key": tex_key,
                    "failure_reason": "",
                    "is_ambiguous": dr.is_ambiguous,
                    "side_used": dr.side_used,
                    "meta_exact": dr.meta_exact,
                    "trace": trace,
                }
            else:
                trace.append({"ok": False, "step": f"Forge dump: icon {dr.texture_key!r} not in texture DB — falling through"})
    else:
        trace.append({"ok": True, "step": "Forge dump: not loaded (install AtlasDumper mod and run GTNH once)"})

    # Stage 3: modern blockstate pipeline
    modern = resolve_block_texture(registry_name, meta, db)
    for t in modern.trace:
        trace.append({"ok": t.ok, "step": t.step})
    if modern.resolved:
        return {
            "registry_name": registry_name,
            "meta": meta,
            "resolved": True,
            "method": "modern",
            "texture_key": modern.texture_key,
            "failure_reason": "",
            "trace": trace,
        }

    # Stage 4: legacy naming-convention resolver
    legacy = resolve_legacy_texture(registry_name, db.texture_colors, meta)
    for msg in legacy.trace:
        trace.append({"ok": legacy.resolved, "step": f"Legacy resolver: {msg}"})

    if legacy.resolved:
        return {
            "registry_name": registry_name,
            "meta": meta,
            "resolved": True,
            "method": legacy.method_tag,
            "texture_key": legacy.texture_key,
            "failure_reason": "",
            "confidence": legacy.confidence,
            "is_ambiguous": legacy.is_ambiguous,
            "top_candidates": legacy.top_candidates,
            "trace": trace,
        }

    return {
        "registry_name": registry_name,
        "meta": meta,
        "resolved": False,
        "method": "none",
        "texture_key": None,
        "failure_reason": modern.failure_reason,
        "confidence": None,
        "is_ambiguous": False,
        "top_candidates": [],
        "trace": trace,
    }

def compute_dump_mismatch(world_path: str) -> dict[str, object]:
    """Compare a world's FML mod list against the loaded icon dump.

    Surfaces instance/version mismatches that cause "no mapping" blocks:
      - mods present in the world but absent from the dump (with how many
        blocks each contributes — those are the ones that won't resolve)
      - mods whose version differs between world and dump
      - differing total mod counts

    Returns ``{"dump_loaded": False}`` when no dump is loaded.
    """
    from collections import Counter

    path = Path(world_path)

    # Make sure the dump is loaded (no-op if already loaded).
    _try_auto_load_dump(find_minecraft_dir(path))
    dump = get_dump_resolver()
    if not dump.is_loaded:
        return {"dump_loaded": False}

    world_mods = read_world_modlist(path)
    dump_mods = dump.mods_map

    # Block count per mod domain (registry name prefix before ':').
    id_map = read_block_id_map(path)
    block_counts: Counter[str] = Counter(
        name.split(":", 1)[0] for name in id_map.values() if ":" in name
    )

    raw_missing: list[tuple[str, str, int]] = []  # (mod_id, world_version, block_count)
    version_mismatches: list[dict[str, object]] = []
    for mod_id, world_ver in world_mods.items():
        if mod_id not in dump_mods:
            raw_missing.append((mod_id, world_ver, int(block_counts.get(mod_id, 0))))
        elif dump_mods[mod_id] and world_ver and dump_mods[mod_id] != world_ver:
            version_mismatches.append({
                "mod_id": mod_id,
                "world_version": world_ver,
                "dump_version": dump_mods[mod_id],
            })

    # Most impactful first: mods that actually contribute blocks.
    raw_missing.sort(key=lambda t: -t[2])
    missing_with_blocks = sum(1 for t in raw_missing if t[2] > 0)
    missing_from_dump: list[dict[str, object]] = [
        {"mod_id": mid, "world_version": wv, "block_count": bc}
        for mid, wv, bc in raw_missing
    ]

    # ── Block-name-level check ─────────────────────────────────────────────
    # Compare every world block registry name against the dump's block keys.
    # A block missing while its mod *is* in the dump is "registration drift" —
    # the cause of un-textured blocks even when the mod lists otherwise agree
    # (e.g. ProjectRed: mod loaded, but its decorative block never dumped).
    raw_mblocks: list[tuple[int, str, str, bool]] = []  # (id, name, domain, mod_in_dump)
    drift_block_count = 0
    for block_id, reg_name in id_map.items():
        if ":" not in reg_name or dump.has_block(reg_name):
            continue
        domain = reg_name.split(":", 1)[0]
        mod_in_dump = domain in dump_mods
        if mod_in_dump:
            drift_block_count += 1
        raw_mblocks.append((block_id, reg_name, domain, mod_in_dump))

    missing_block_total = len(raw_mblocks)
    # Drift first (mod present but block absent — the surprising ones), then domain.
    # The client ranks these by on-map occurrence, so keep a generous cap.
    raw_mblocks.sort(key=lambda t: (not t[3], t[2], t[1]))
    block_cap = 1000
    missing_blocks: list[dict[str, object]] = [
        {"registry_name": rn, "block_id": bid, "domain": dom,
         "mod_in_dump": mid, "drift": mid}
        for bid, rn, dom, mid in raw_mblocks[:block_cap]
    ]

    count_differs = len(world_mods) != len(dump_mods)
    has_mismatch = bool(
        missing_from_dump or version_mismatches or count_differs or missing_block_total
    )

    # Mod-level severity. Block-level drift stays at "info" here because many
    # missing blocks are technical/TESR blocks that never appear on a top-down
    # map — the client escalates to "error" only when a missing block is actually
    # visible (has on-map occurrences), which avoids false alarms.
    #   error — a whole mod with blocks is absent from the dump
    #   warn  — mod versions differ (textures may be subtly wrong)
    #   info  — benign mod differences, or block drift within present mods
    #   ok    — world and dump agree
    if missing_with_blocks > 0:
        severity = "error"
    elif version_mismatches:
        severity = "warn"
    elif missing_from_dump or count_differs or missing_block_total:
        severity = "info"
    else:
        severity = "ok"

    return {
        "dump_loaded": True,
        "has_mismatch": has_mismatch,
        "severity": severity,
        "world_mod_count": len(world_mods),
        "dump_mod_count": len(dump_mods),
        "count_differs": count_differs,
        "missing_with_blocks": missing_with_blocks,
        "missing_from_dump": missing_from_dump,
        "version_mismatches": version_mismatches,
        "missing_block_total": missing_block_total,
        "drift_block_count": drift_block_count,
        "missing_blocks": missing_blocks,
    }


def build_missing_block_report(
    world_path: str,
    occurrences: dict[int, int] | None = None,
    metas: dict[int, list[int]] | None = None,
) -> dict[str, object]:
    """Build a diagnostic report of every world block absent from the icon dump.

    Each row joins the cheap backend facts (id, domain, mod versions, resolver
    result, fallback reason) with optional client-supplied on-map data
    (``occurrences`` = columns rendered, ``metas`` = metadata values seen).
    The block list is complete; occurrence/metas are 0/empty for blocks the
    client hasn't rendered yet.
    """
    from datetime import UTC, datetime

    occurrences = occurrences or {}
    metas = metas or {}

    path = Path(world_path)
    _try_auto_load_dump(find_minecraft_dir(path))
    dump = get_dump_resolver()
    world_mods = read_world_modlist(path)
    dump_mods = dump.mods_map
    id_map = read_block_id_map(path)
    db = get_block_color_service(world_path).asset_db()

    rows: list[dict[str, object]] = []
    for block_id, reg_name in id_map.items():
        if ":" not in reg_name or (dump.is_loaded and dump.has_block(reg_name)):
            continue
        domain = reg_name.split(":", 1)[0]
        key, method = _resolve_unified(reg_name, 0, db)
        fallback_reason = ""
        if key is None:
            modern = resolve_block_texture(reg_name, 0, db)
            fallback_reason = modern.failure_reason or "no resolver matched"
        rows.append({
            "registry_name": reg_name,
            "block_id": block_id,
            "domain": domain,
            "metas_seen": sorted(metas.get(block_id, [])),
            "occurrence_columns": int(occurrences.get(block_id, 0)),
            "mod_in_dump": domain in dump_mods,
            "world_mod_version": world_mods.get(domain, ""),
            "dump_mod_version": dump_mods.get(domain, ""),
            "resolver_method": method,
            "resolver_texture_key": key,
            "fallback_reason": fallback_reason,
        })

    # Most impactful first: blocks actually covering the map.
    def _sort_key(r: dict[str, object]) -> tuple[int, str, str]:
        return (-int(r["occurrence_columns"]), str(r["domain"]), str(r["registry_name"]))  # type: ignore[call-overload]
    rows.sort(key=_sort_key)

    return {
        "format": "atlas-missing-block-report-v1",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "world_path": world_path,
        "dump_loaded": dump.is_loaded,
        "dump_path": dump.path,
        "summary": {
            "missing_block_count": len(rows),
            "drift_block_count": sum(1 for r in rows if r["mod_in_dump"]),
            "on_map_block_count": sum(1 for r in rows if int(r["occurrence_columns"]) > 0),  # type: ignore[call-overload]
        },
        "blocks": rows,
    }


def missing_block_report_csv(report: dict[str, object]) -> str:
    """Serialise a missing-block report (from build_missing_block_report) to CSV."""
    import csv
    import io

    fields = [
        "registry_name", "block_id", "domain", "metas_seen", "occurrence_columns",
        "mod_in_dump", "world_mod_version", "dump_mod_version",
        "resolver_method", "resolver_texture_key", "fallback_reason",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in report.get("blocks", []):  # type: ignore[union-attr]
        out = dict(row)
        metas = out.get("metas_seen")
        if isinstance(metas, list):
            out["metas_seen"] = ";".join(str(m) for m in metas)
        writer.writerow(out)
    return buf.getvalue()


def debug_texture_resolution(world_path: str) -> dict[str, object]:
    """Return diagnostic data for the full texture-resolution chain.

    Covers: mc_dir, JARs found, texture_colors count, vanilla key presence,
    and per-block resolution trace.  Does NOT use the in-process caches so
    results always reflect the current file-system state.
    """
    path = Path(world_path)
    mc_dir = find_minecraft_dir(path)
    jars = _collect_jars(mc_dir) if mc_dir else []

    # Rescan (may hit SQLite cache but not the in-process dict cache)
    all_colors: dict[str, tuple[int, int, int]] = {}
    jar_info: list[dict] = []
    for jar in jars:
        cached = load_jar_colors(jar)
        if cached is not None:
            all_colors.update(cached)
            jar_info.append({"jar": jar.name, "status": "cached", "keys": len(cached)})
        else:
            try:
                fresh = scan_jar(jar)
                save_jar_colors(jar, fresh)
                for name, (avg, dom) in fresh.items():
                    all_colors[name] = dom if dom is not None else avg
                jar_info.append({"jar": jar.name, "status": "scanned", "keys": len(fresh)})
            except Exception as exc:
                jar_info.append({"jar": jar.name, "status": f"error: {exc}", "keys": 0})

    id_map = read_block_id_map(path)

    vanilla_check = {
        k: k in all_colors
        for k in ("minecraft:stone", "minecraft:grass_top", "minecraft:cobblestone",
                   "minecraft:dirt", "minecraft:water_still", "minecraft:leaves_oak")
    }

    blocks = []
    for block_id, registry_name in sorted(id_map.items()):
        resolved = _resolve_texture_key(registry_name, all_colors)
        fallback = None if resolved else _VANILLA_TEXTURE_KEYS.get(registry_name.lower())
        blocks.append({
            "id": block_id,
            "name": registry_name,
            "resolved_key": resolved,
            "fallback_key": fallback,
            "source": "jar" if resolved else ("fallback" if fallback else "none"),
        })

    return {
        "mc_dir": str(mc_dir) if mc_dir else None,
        "jars": jar_info,
        "texture_color_count": len(all_colors),
        "vanilla_keys_in_colors": vanilla_check,
        "blocks": blocks,
    }
