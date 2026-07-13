"""Serve raw block texture PNG bytes from mod JARs.

Textures are keyed by the same 'domain:name' strings used in the color cache
(e.g. 'minecraft:stone', 'biomesoplenty:leaves_colorized_2').  Results are
cached in-process; the first read opens the JAR and extracts the PNG once.
"""

import threading
import zipfile
from pathlib import Path

from app.services.color_cache import get_texture_source_jar

# In-process cache: texture_key → PNG bytes (None = confirmed missing).
# _cache_lock serialises the miss path so a key isn't read from disk twice.
_cache: dict[str, bytes | None] = {}
_cache_lock = threading.Lock()


def get_texture_png(texture_key: str) -> bytes | None:
    """Return PNG bytes for *texture_key*, or None if unavailable.

    The key format is 'domain:name', e.g. 'minecraft:stone' which maps to
    assets/minecraft/textures/blocks/stone.png inside the JAR.
    For sub-directory textures the name includes slashes:
    'gregtech:machines/furnace_top' → assets/gregtech/textures/blocks/machines/furnace_top.png
    """
    if texture_key in _cache:
        return _cache[texture_key]
    with _cache_lock:
        if texture_key in _cache:  # another thread may have just loaded it
            return _cache[texture_key]
        png = _load_texture_png(texture_key)
        _cache[texture_key] = png
        return png


def get_textures_batch(keys: list[str]) -> dict[str, bytes | None]:
    """Return PNG bytes for many keys, opening each source JAR only once.

    The initial preload needs hundreds of textures; resolving them one-by-one
    re-opens (and re-reads the central directory of) the same JAR over and over.
    Grouping cache-missed keys by their source JAR collapses that to one open
    per JAR. Already-cached keys are returned straight from the in-process cache.
    """
    result: dict[str, bytes | None] = {}
    misses_by_jar: dict[str, list[str]] = {}

    for key in keys:
        if key in _cache:
            result[key] = _cache[key]
            continue
        source_jar = get_texture_source_jar(key)
        if not source_jar or ":" not in key or not Path(source_jar).exists():
            with _cache_lock:
                _cache.setdefault(key, None)
            result[key] = None
            continue
        misses_by_jar.setdefault(source_jar, []).append(key)

    for source_jar, jar_keys in misses_by_jar.items():
        loaded = _read_keys_from_jar(source_jar, jar_keys)
        with _cache_lock:
            for key in jar_keys:
                _cache.setdefault(key, loaded.get(key))
                result[key] = _cache[key]
    return result


def _fuzzy_zip_entry(namelist_lower: dict[str, str], domain: str, name: str) -> str | None:
    """Resolve a texture to an actual ZIP entry, case-insensitively.

    *namelist_lower* maps lowercased entry name → original entry name.
    Absorbs two mismatches: (1) mod JARs (IC2, BuildCraft, …) use camelCase
    filenames; (2) the color scan stores a filename-only alias for textures that
    actually live in a subdirectory (e.g. projectred:basalt_brick →
    assets/projectred/textures/blocks/world/basalt_brick.png).
    Prefers an exact path match, else any entry under the domain's blocks dir
    ending in /{name}.png.
    """
    target = f"assets/{domain}/textures/blocks/{name}.png".lower()
    exact = namelist_lower.get(target)
    if exact is not None:
        return exact
    prefix = f"assets/{domain}/textures/blocks/".lower()
    suffix = f"/{name}.png".lower()
    for entry_lower, entry in namelist_lower.items():
        if entry_lower.startswith(prefix) and entry_lower.endswith(suffix):
            return entry
    return None


def _read_keys_from_jar(source_jar: str, keys: list[str]) -> dict[str, bytes]:
    """Read several texture PNGs from a single open JAR. Missing keys are omitted.

    The lowercased namelist (needed for the fuzzy fallback) is built at most once
    per JAR, only if some key isn't found by its exact path.
    """
    out: dict[str, bytes] = {}
    namelist_lower: dict[str, str] | None = None
    try:
        with zipfile.ZipFile(source_jar, "r") as zf:
            for key in keys:
                domain, name = key.split(":", 1)
                jar_path = f"assets/{domain}/textures/blocks/{name}.png"
                try:
                    out[key] = zf.read(jar_path)
                    continue
                except KeyError:
                    pass
                if namelist_lower is None:
                    namelist_lower = {e.lower(): e for e in zf.namelist()}
                chosen = _fuzzy_zip_entry(namelist_lower, domain, name)
                if chosen is not None:
                    out[key] = zf.read(chosen)
    except (zipfile.BadZipFile, OSError):
        return out
    return out


def _load_texture_png(texture_key: str) -> bytes | None:
    """Read the PNG bytes for *texture_key* from its source JAR (no caching)."""
    source_jar = get_texture_source_jar(texture_key)
    if not source_jar or not Path(source_jar).exists():
        return None

    if ":" not in texture_key:
        return None

    domain, name = texture_key.split(":", 1)
    jar_path = f"assets/{domain}/textures/blocks/{name}.png"

    try:
        with zipfile.ZipFile(source_jar, "r") as zf:
            try:
                return zf.read(jar_path)
            except KeyError:
                namelist_lower = {e.lower(): e for e in zf.namelist()}
                chosen = _fuzzy_zip_entry(namelist_lower, domain, name)
                return zf.read(chosen) if chosen is not None else None
    except (zipfile.BadZipFile, OSError):
        return None


def clear_texture_cache() -> None:
    _cache.clear()
