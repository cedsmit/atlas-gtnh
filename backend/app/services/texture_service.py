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
                # Two mismatches to absorb, case-insensitively:
                #  1. mod JARs (IC2, BuildCraft, …) use camelCase filenames;
                #  2. the color scan stores a filename-only alias for textures that
                #     actually live in a subdirectory (e.g. projectred:basalt_brick
                #     → assets/projectred/textures/blocks/world/basalt_brick.png).
                # Prefer an exact path match, else any entry under this domain's
                # blocks dir ending in /{name}.png.
                target_lower = jar_path.lower()
                prefix = f"assets/{domain}/textures/blocks/".lower()
                suffix = f"/{name}.png".lower()
                exact: str | None = None
                subdir: str | None = None
                for entry in zf.namelist():
                    el = entry.lower()
                    if el == target_lower:
                        exact = entry
                        break
                    if subdir is None and el.startswith(prefix) and el.endswith(suffix):
                        subdir = entry
                chosen = exact or subdir
                if chosen is None:
                    return None
                return zf.read(chosen)
    except (zipfile.BadZipFile, OSError):
        return None


def clear_texture_cache() -> None:
    _cache.clear()
