"""Per-world block colour / texture service.

Owns one world's derived asset state (the scanned AssetDatabase plus the
block-id → colour / texture-key / meta-texture-key maps) behind a single lock.
Pure resolution helpers live in block_color_resolution; diagnostic/report
functions live in block_color_diagnostics.
"""

import threading
from pathlib import Path

from app.services.block_color_resolution import (
    _VANILLA_COLORS,
    _VANILLA_TEXTURE_KEYS,
    _augment_meta_map_from_dump,
    _build_color_map,
    _build_meta_texture_map_for_world,
    _build_texture_key_map,
    _load_asset_db,
)
from app.services.blockstate_resolver import AssetDatabase
from app.world.block_registry import read_block_id_map


class BlockColorService:
    """Owns one world's derived asset state: the scanned AssetDatabase and the
    block-id → color / texture-key / meta-texture-key maps.

    Every lazy build is serialised by a single re-entrant lock, so concurrent
    requests for the same world build each map once. Because the asset DB is only
    published after its build completes (and the build loads the icon dump),
    meta-variant textures resolve deterministically — no half-built shared state.
    """

    def __init__(self, world_path: str) -> None:
        self.world_path = world_path
        self._lock = threading.RLock()
        self._asset_db: AssetDatabase | None = None
        self._color_map: dict[int, list[int]] | None = None
        self._texture_key_map: dict[int, str] | None = None
        self._meta_texture_key_map: dict[str, str] | None = None

    def asset_db(self) -> AssetDatabase:
        """The world's scanned AssetDatabase (built once; dump loaded with it)."""
        if self._asset_db is None:
            with self._lock:
                if self._asset_db is None:
                    self._asset_db = _load_asset_db(self.world_path)
        return self._asset_db

    def block_color_map(self) -> dict[int, list[int]]:
        """Block-id → RGB color map, with vanilla fallbacks filled in."""
        if self._color_map is not None:
            return self._color_map
        with self._lock:
            if self._color_map is None:
                id_map = read_block_id_map(Path(self.world_path))
                if not id_map:
                    self._color_map = {}
                else:
                    result = _build_color_map(id_map, self.asset_db())
                    # Fill in vanilla blocks when the Minecraft JAR wasn't scanned.
                    for block_id, color in _VANILLA_COLORS.items():
                        if block_id not in result:
                            result[block_id] = color
                    self._color_map = result
        return self._color_map

    def block_texture_map(self) -> dict[int, str]:
        """Block-id → texture-key map, with vanilla fallbacks filled in."""
        if self._texture_key_map is not None:
            return self._texture_key_map
        with self._lock:
            if self._texture_key_map is None:
                id_map = read_block_id_map(Path(self.world_path))
                if not id_map:
                    self._texture_key_map = {}
                else:
                    result = _build_texture_key_map(id_map, self.asset_db())
                    # Fill vanilla blocks whose JAR textures weren't scanned.
                    for block_id, registry_name in id_map.items():
                        if block_id not in result:
                            fallback = _VANILLA_TEXTURE_KEYS.get(registry_name.lower())
                            if fallback:
                                result[block_id] = fallback
                    self._texture_key_map = result
        return self._texture_key_map

    def block_meta_texture_map(self) -> dict[str, str]:
        """'{block_id}:{meta}' → texture-key for meta-variant blocks.

        Curated vanilla meta tables first, then Forge icon-dump per-meta icons
        (GregTech machines/casings/ores, Chisel variants, …) for everything else.
        """
        if self._meta_texture_key_map is not None:
            return self._meta_texture_key_map
        with self._lock:
            if self._meta_texture_key_map is None:
                id_map = read_block_id_map(Path(self.world_path))
                if not id_map:
                    self._meta_texture_key_map = {}
                else:
                    db = self.asset_db()  # also ensures the icon dump is loaded
                    result = _build_meta_texture_map_for_world(id_map)
                    _augment_meta_map_from_dump(id_map, db, result)
                    self._meta_texture_key_map = result
        return self._meta_texture_key_map


class BlockColorServiceRegistry:
    """Maps world_path → BlockColorService, creating each instance at most once."""

    def __init__(self) -> None:
        self._services: dict[str, BlockColorService] = {}
        self._lock = threading.Lock()

    def get(self, world_path: str) -> BlockColorService:
        svc = self._services.get(world_path)
        if svc is not None:
            return svc
        with self._lock:
            svc = self._services.get(world_path)
            if svc is None:
                svc = BlockColorService(world_path)
                self._services[world_path] = svc
            return svc

    def evict(self, world_path: str) -> None:
        with self._lock:
            self._services.pop(world_path, None)

    def clear(self) -> None:
        with self._lock:
            self._services.clear()


_default_registry = BlockColorServiceRegistry()


def get_block_color_service(world_path: str) -> BlockColorService:
    """Return the process-shared BlockColorService for *world_path*."""
    return _default_registry.get(world_path)


def build_block_color_map(world_path: str) -> dict[int, list[int]]:
    """Block-id → RGB color map for *world_path* (cached per world)."""
    return _default_registry.get(world_path).block_color_map()


def build_block_texture_map(world_path: str) -> dict[int, str]:
    """Block-id → texture-key map for *world_path* (cached per world).

    The texture key is the same 'domain:name' string used to serve PNG bytes
    from the texture endpoint, e.g. 'minecraft:stone' or 'gregtech:ore_stone'.
    """
    return _default_registry.get(world_path).block_texture_map()


def build_block_meta_texture_map(world_path: str) -> dict[str, str]:
    """'{block_id}:{meta}' → texture-key for meta-variant blocks (cached per world)."""
    return _default_registry.get(world_path).block_meta_texture_map()
