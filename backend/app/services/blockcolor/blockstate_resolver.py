"""
Blockstate → Model → Texture pipeline resolver for Minecraft 1.7.10 / GTNH.

Follows Minecraft's actual asset resolution chain:
  registry_name → blockstate JSON → variant → model JSON chain
  → texture variables → texture PNG key → average color

Supports:
  - Vanilla blockstate format  (variants dict)
  - Forge blockstate format    (forge_marker: 1, defaults + per-variant overrides)
  - Multipart blockstates      (picks first unconditional apply block)
  - Model parent inheritance   (recursive, depth-limited)
  - Texture variable (#var)    resolution through parent chain
  - Top-face extraction        (up > top > end > all > side > particle)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.blockcolor.asset_database import AssetDatabase

# ── Failure-reason tags ───────────────────────────────────────────────────────

REASON_NO_BLOCKSTATE          = "no_blockstate"
REASON_FORGE_BUILTIN          = "forge_builtin_renderer"
REASON_NO_VARIANT             = "no_variant_for_meta"
REASON_MODEL_NOT_FOUND        = "model_not_found"
REASON_TEXTURE_VAR_UNRESOLVED = "texture_variable_unresolved"
REASON_TEXTURE_NOT_IN_DB      = "texture_not_in_db"
REASON_BAD_FORMAT             = "bad_blockstate_format"

# Top-face texture variable names, checked in priority order.
_TOP_FACE_VARS = ("up", "top", "end", "all", "side", "side_all", "particle", "cross")


# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class ResolveTrace:
    ok: bool
    step: str


@dataclass
class ResolveResult:
    texture_key: str | None
    failure_reason: str
    trace: list[ResolveTrace] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return self.texture_key is not None

    def _add(self, ok: bool, step: str) -> ResolveResult:
        self.trace.append(ResolveTrace(ok=ok, step=step))
        return self


# ── Main pipeline ─────────────────────────────────────────────────────────────

def resolve_block_texture(registry_name: str, meta: int, db: AssetDatabase) -> ResolveResult:
    """
    Resolve the top-face texture key for a block given its FML registry name and metadata.

    Returns ResolveResult with .texture_key on success or .failure_reason on failure.
    The .trace list records a step-by-step audit trail suitable for debug display.
    """
    result = ResolveResult(texture_key=None, failure_reason="")

    if ":" not in registry_name:
        result.failure_reason = REASON_BAD_FORMAT
        return result._add(False, f"Invalid registry name (no ':'): {registry_name}")

    raw_lower = registry_name.lower()
    raw_domain, block_name = raw_lower.split(":", 1)
    # BuildCraft|Factory → buildcraft  (assets live under clean domain)
    clean_domain = raw_domain.split("|")[0]
    result._add(True, f"Block: {registry_name}")

    # Step 1 – blockstate JSON ─────────────────────────────────────────────────
    blockstate = db.blockstates.get(f"{clean_domain}:{block_name}")
    if blockstate is None:
        result.failure_reason = REASON_NO_BLOCKSTATE
        return result._add(
            False,
            f"No blockstate: assets/{clean_domain}/blockstates/{block_name}.json",
        )
    result._add(True, f"Blockstate: {clean_domain}:{block_name}.json")

    # Step 2 – select model ref + inline textures ──────────────────────────────
    model_ref, inline_textures, fail_reason = _select_model_ref(blockstate, meta)
    if model_ref is None and not inline_textures:
        result.failure_reason = fail_reason or REASON_NO_VARIANT
        return result._add(False, f"No model ref for meta={meta}: {fail_reason}")
    if model_ref == "__builtin__":
        result.failure_reason = REASON_FORGE_BUILTIN
        return result._add(False, "Block uses builtin/entity renderer — no static texture")
    inline_note = f" + {len(inline_textures)} inline tex" if inline_textures else ""
    result._add(True, f"Model ref: {model_ref!r}{inline_note}")

    # Step 3 – build merged texture map via model parent chain ─────────────────
    if model_ref:
        model_key = _normalize_model_ref(model_ref, clean_domain)
        model_textures, fail2 = _build_texture_map(model_key, db, frozenset(), clean_domain)
    else:
        model_textures, fail2 = {}, None

    if model_textures is not None:
        merged = {**model_textures, **inline_textures}
        result._add(True, f"Model chain OK → {len(merged)} texture var(s)")
    elif inline_textures:
        merged = dict(inline_textures)
        result._add(True, f"Model chain failed ({fail2}); using {len(merged)} inline textures")
    else:
        result.failure_reason = fail2 or REASON_MODEL_NOT_FOUND
        return result._add(False, f"Model chain failed: {fail2}")

    if not merged:
        result.failure_reason = REASON_FORGE_BUILTIN
        return result._add(False, "Model chain resolved to builtin with no textures")

    # Step 4 – resolve top-face texture path ───────────────────────────────────
    top_path, fail3 = _get_top_texture_path(merged)
    if top_path is None:
        result.failure_reason = REASON_TEXTURE_VAR_UNRESOLVED
        return result._add(False, f"No top-face var. Map vars: {sorted(merged)[:8]}")
    result._add(True, f"Top-face path: {top_path}")

    # Step 5 – look up color in scanned texture DB ─────────────────────────────
    tex_key = _texture_path_to_key(top_path, clean_domain)
    if tex_key not in db.texture_colors:
        result.failure_reason = REASON_TEXTURE_NOT_IN_DB
        return result._add(False, f"Key '{tex_key}' not in scanned colors")

    result.texture_key = tex_key
    result._add(True, f"Resolved: {tex_key}")
    return result


# ── Batch failure report ──────────────────────────────────────────────────────

def generate_pipeline_report(id_map: dict[int, str], db: AssetDatabase) -> dict[str, Any]:
    """
    Run the blockstate pipeline for every block and categorize outcomes.
    Returns a summary with resolved count, failure categories, and examples.
    """
    from collections import Counter, defaultdict

    resolved_count = 0
    category_counts: Counter[str] = Counter()
    category_examples: dict[str, list[str]] = defaultdict(list)

    for block_id, registry_name in sorted(id_map.items()):
        result = resolve_block_texture(registry_name, 0, db)
        if result.resolved:
            resolved_count += 1
        else:
            cat = result.failure_reason
            category_counts[cat] += 1
            if len(category_examples[cat]) < 8:
                category_examples[cat].append(f"[{block_id}] {registry_name}")

    total = len(id_map)
    return {
        "total": total,
        "pipeline_resolved": resolved_count,
        "pipeline_unresolved": total - resolved_count,
        "categories": dict(category_counts.most_common()),
        "examples": dict(category_examples),
    }


# ── Blockstate variant selection ──────────────────────────────────────────────

def _select_model_ref(
    blockstate: dict, meta: int
) -> tuple[str | None, dict[str, str], str | None]:
    """
    Select the model ref and any inline textures from a blockstate JSON.
    Returns (model_ref | '__builtin__' | None, inline_textures, failure_reason).
    """
    if blockstate.get("forge_marker") == 1:
        return _select_forge_model_ref(blockstate, meta)

    if "multipart" in blockstate:
        parts = blockstate["multipart"]
        # Prefer first unconditional apply block (best map representative).
        for part in parts:
            if "when" not in part:
                ref = _extract_vanilla_ref(part.get("apply", {}))
                if ref:
                    return ref, {}, None
        # Fall back to first part regardless.
        if parts:
            ref = _extract_vanilla_ref(parts[0].get("apply", {}))
            if ref:
                return ref, {}, None
        return None, {}, REASON_NO_VARIANT

    variants = blockstate.get("variants")
    if not isinstance(variants, dict) or not variants:
        return None, {}, REASON_BAD_FORMAT

    # Try variant keys in priority order.
    for key in (
        "normal", "",
        str(meta), f"meta={meta}", f"damage={meta}", f"type={meta}",
        "facing=north", "facing=south", "powered=false", "open=false",
        "variant=normal",
    ):
        entry = variants.get(key)
        if entry is not None:
            ref = _extract_vanilla_ref(entry)
            if ref:
                return ref, {}, None

    # Fall back to first variant with a model.
    for entry in variants.values():
        ref = _extract_vanilla_ref(entry)
        if ref:
            return ref, {}, None

    return None, {}, REASON_NO_VARIANT


def _select_forge_model_ref(
    blockstate: dict, meta: int
) -> tuple[str | None, dict[str, str], str | None]:
    """Handle Forge blockstate format (forge_marker: 1)."""
    defaults: dict = blockstate.get("defaults") or {}
    variants: dict = blockstate.get("variants") or {}

    # Meta-specific keys first.
    for key in (str(meta), f"meta={meta}", f"type={meta}", f"damage={meta}"):
        entry = variants.get(key)
        if entry is not None:
            ref, tex, reason = _extract_forge_ref_and_textures(entry, defaults)
            if ref or tex:
                return ref, tex, reason

    # Then "normal" / "inventory" / "".
    for key in ("normal", "inventory", ""):
        entry = variants.get(key)
        if entry is not None:
            ref, tex, reason = _extract_forge_ref_and_textures(entry, defaults)
            if ref or tex:
                return ref, tex, reason

    # Use defaults alone (no variant data contributed anything).
    model = defaults.get("model")
    textures: dict[str, str] = {
        k: v for k, v in (defaults.get("textures") or {}).items()
        if isinstance(k, str) and isinstance(v, str)
    }
    if model in ("builtin/entity", "builtin/generated"):
        return "__builtin__", {}, None
    if model or textures:
        return model, textures, None

    # Try any variant as last resort.
    for entry in variants.values():
        ref, tex, reason = _extract_forge_ref_and_textures(entry, defaults)
        if ref or tex:
            return ref, tex, reason

    return None, {}, REASON_NO_VARIANT


def _extract_forge_ref_and_textures(
    entry: list | dict | None,
    defaults: dict,
) -> tuple[str | None, dict[str, str], str | None]:
    if isinstance(entry, list):
        entry = entry[0] if entry else {}
    if not isinstance(entry, dict):
        entry = {}
    merged = {**defaults, **entry}
    model = merged.get("model")
    textures: dict[str, str] = {
        k: v for k, v in (merged.get("textures") or {}).items()
        if isinstance(k, str) and isinstance(v, str)
    }
    if model in ("builtin/entity", "builtin/generated"):
        return "__builtin__", {}, None
    return model, textures, None


def _extract_vanilla_ref(entry: list | dict | None) -> str | None:
    if isinstance(entry, list):
        entry = entry[0] if entry else {}
    if isinstance(entry, dict):
        model = entry.get("model")
        if model in ("builtin/entity", "builtin/generated"):
            return "__builtin__"
        return model
    return None


# ── Model chain resolution ────────────────────────────────────────────────────

def _normalize_model_ref(ref: str, default_domain: str) -> str:
    """
    Normalize a model reference to the 'domain:block/path' key format used in
    the asset DB.

    "stone"              (domain=minecraft) → "minecraft:block/stone"
    "block/cube_all"     (domain=minecraft) → "minecraft:block/cube_all"
    "ic2:generator"      → "ic2:block/generator"
    "minecraft:block/x"  → "minecraft:block/x"
    """
    ref = ref.strip().lower()
    if ref.startswith("builtin/"):
        return f"minecraft:{ref}"
    if ":" in ref:
        domain, path = ref.split(":", 1)
    else:
        domain = default_domain
        path = ref
    if not path.startswith("block/") and not path.startswith("builtin/"):
        path = f"block/{path}"
    return f"{domain}:{path}"


def _build_texture_map(
    model_key: str,
    db: AssetDatabase,
    visited: frozenset[str],
    default_domain: str,
    depth: int = 0,
) -> tuple[dict[str, str] | None, str | None]:
    """
    Recursively build the merged texture variable map by following parent chain.

    Returns (merged_texture_map, None) on success.
    Returns (None, reason) when the root model is missing and no textures exist.
    Returns ({}, None) for builtin models (stop chain but don't fail).
    When a parent is missing but the current model has textures, returns those
    textures as best-effort — this handles the common case where vanilla parent
    models (cube_all, cube_column …) are absent from the scanned JARs.
    """
    if depth > 12:
        return None, f"parent_chain_too_deep:{model_key}"
    if model_key in visited:
        return {}, None
    if model_key.startswith("minecraft:builtin/"):
        return {}, None

    model = db.models.get(model_key)
    if model is None:
        return None, f"{REASON_MODEL_NOT_FOUND}:{model_key}"

    own: dict[str, str] = {
        k: v for k, v in (model.get("textures") or {}).items()
        if isinstance(k, str) and isinstance(v, str)
    }
    parent_str: str = (model.get("parent") or "").strip().lower()

    if not parent_str:
        return dict(own), None

    parent_key = _normalize_model_ref(parent_str, default_domain)
    if parent_key.startswith("minecraft:builtin/"):
        return dict(own), None

    parent_textures, fail_reason = _build_texture_map(
        parent_key, db, visited | {model_key}, default_domain, depth + 1
    )
    if parent_textures is None:
        # Parent missing — use own textures as best-effort fallback.
        # Covers the very common case where cube/cube_all isn't in the JAR
        # but the child already has the texture variable resolved.
        return (dict(own), None) if own else (None, fail_reason)

    # Child's textures override parent's (standard Minecraft inheritance).
    return {**parent_textures, **own}, None


# ── Texture variable resolution ───────────────────────────────────────────────

def _get_top_texture_path(texture_map: dict[str, str]) -> tuple[str | None, str | None]:
    for var_name in _TOP_FACE_VARS:
        raw = texture_map.get(var_name)
        if raw is None:
            continue
        resolved = _resolve_var(raw, texture_map, 0)
        if resolved is not None:
            return resolved, None
    return None, f"No resolvable top-face var; map keys: {sorted(texture_map)[:8]}"


def _resolve_var(value: str, texture_map: dict[str, str], depth: int) -> str | None:
    if depth > 8:
        return None
    if not value.startswith("#"):
        return value  # literal texture path
    key = value[1:]
    inner = texture_map.get(key)
    if inner is None:
        return None
    return _resolve_var(inner, texture_map, depth + 1)


def _texture_path_to_key(path: str, default_domain: str) -> str:
    """
    Convert a model texture reference to the color-DB lookup key used by scan_jar.

    scan_jar stores textures from assets/{domain}/textures/blocks/{name}.png as
    '{domain}:{name}'.  Model references include the 'blocks/' prefix, so we strip it.

    "blocks/stone"           → "{default_domain}:stone"
    "minecraft:blocks/stone" → "minecraft:stone"
    "ic2:blocks/gen_top"     → "ic2:gen_top"
    "ic2:blocks/machines/x"  → "ic2:machines/x"  (scan_jar also stores subdir paths)
    """
    path = path.strip().lower()
    if ":" in path:
        domain, rest = path.split(":", 1)
    else:
        domain = default_domain
        rest = path
    if rest.startswith("blocks/"):
        rest = rest[7:]
    return f"{domain}:{rest}"
