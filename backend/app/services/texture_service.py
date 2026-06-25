"""Serve raw block texture PNG bytes from mod JARs.

Textures are keyed by the same 'domain:name' strings used in the color cache
(e.g. 'minecraft:stone', 'biomesoplenty:leaves_colorized_2').  Results are
cached in-process; the first read opens the JAR and extracts the PNG once.
"""

import zipfile
from pathlib import Path

from app.services.color_cache import get_texture_source_jar

# In-process cache: texture_key → PNG bytes (None = confirmed missing)
_cache: dict[str, bytes | None] = {}


def get_texture_png(texture_key: str) -> bytes | None:
    """Return PNG bytes for *texture_key*, or None if unavailable.

    The key format is 'domain:name', e.g. 'minecraft:stone' which maps to
    assets/minecraft/textures/blocks/stone.png inside the JAR.
    For sub-directory textures the name includes slashes:
    'gregtech:machines/furnace_top' → assets/gregtech/textures/blocks/machines/furnace_top.png
    """
    if texture_key in _cache:
        return _cache[texture_key]

    source_jar = get_texture_source_jar(texture_key)
    if not source_jar or not Path(source_jar).exists():
        _cache[texture_key] = None
        return None

    if ":" not in texture_key:
        _cache[texture_key] = None
        return None

    domain, name = texture_key.split(":", 1)
    jar_path = f"assets/{domain}/textures/blocks/{name}.png"

    try:
        with zipfile.ZipFile(source_jar, "r") as zf:
            try:
                png = zf.read(jar_path)
            except KeyError:
                # Keys are stored lowercase but mod JARs (IC2, BuildCraft, etc.) use
                # camelCase filenames — do a case-insensitive scan to find the entry.
                target_lower = jar_path.lower()
                png = None
                for entry in zf.namelist():
                    if entry.lower() == target_lower:
                        png = zf.read(entry)
                        break
            if png is None:
                _cache[texture_key] = None
                return None
        _cache[texture_key] = png
        return png
    except (zipfile.BadZipFile, OSError):
        _cache[texture_key] = None
        return None


def clear_texture_cache() -> None:
    _cache.clear()
