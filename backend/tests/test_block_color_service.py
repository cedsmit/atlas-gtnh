"""Unit tests for the BlockColorService / registry encapsulation.

These exercise the service in isolation — no real world, no global state to reset
between tests — which is the point of moving the per-world caches into an object.
"""

from pathlib import Path

import pytest

from app.services.blockcolor import service as bcs


def test_registry_returns_same_instance_per_world() -> None:
    reg = bcs.BlockColorServiceRegistry()
    a = reg.get("/world/a")
    assert reg.get("/world/a") is a  # memoized
    assert reg.get("/world/b") is not a  # distinct worlds, distinct services


def test_registry_evict_and_clear() -> None:
    reg = bcs.BlockColorServiceRegistry()
    a = reg.get("/world/a")
    reg.evict("/world/a")
    b = reg.get("/world/a")
    assert b is not a  # evicted → rebuilt
    reg.clear()
    assert reg.get("/world/a") is not b  # cleared → rebuilt


def test_each_service_owns_an_independent_lock() -> None:
    reg = bcs.BlockColorServiceRegistry()
    assert reg.get("/world/a")._lock is not reg.get("/world/b")._lock


def test_maps_are_built_once_and_memoized(tmp_path: Path) -> None:
    # An empty world dir (no level.dat) yields empty maps, cached as one object.
    svc = bcs.BlockColorService(str(tmp_path))

    cmap = svc.block_color_map()
    assert cmap == {}
    assert svc.block_color_map() is cmap

    tmap = svc.block_texture_map()
    assert tmap == {}
    assert svc.block_texture_map() is tmap

    mmap = svc.block_meta_texture_map()
    assert mmap == {}
    assert svc.block_meta_texture_map() is mmap

    db = svc.asset_db()
    assert svc.asset_db() is db  # asset DB built once


def test_all_maps_share_one_level_dat_parse(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    reads = 0
    id_map = {1: "minecraft:stone"}

    def read_once(_path: Path) -> dict[int, str]:
        nonlocal reads
        reads += 1
        return id_map

    svc = bcs.BlockColorService(str(tmp_path))
    monkeypatch.setattr(bcs, "read_block_id_map", read_once)
    monkeypatch.setattr(svc, "asset_db", lambda: object())
    monkeypatch.setattr(bcs, "_build_color_map", lambda ids, _db: {next(iter(ids)): [1, 2, 3]})
    monkeypatch.setattr(bcs, "_build_texture_key_map", lambda ids, _db: {next(iter(ids)): "x"})
    monkeypatch.setattr(bcs, "_build_meta_texture_map_for_world", lambda _ids: {})
    monkeypatch.setattr(bcs, "_augment_meta_map_from_dump", lambda _ids, _db, _out: None)

    assert svc.block_id_map() is id_map
    svc.block_color_map()
    svc.block_texture_map()
    svc.block_meta_texture_map()

    assert reads == 1


def test_shims_delegate_to_the_default_registry(tmp_path: Path) -> None:
    p = str(tmp_path)
    assert bcs.build_block_color_map(p) is bcs.get_block_color_service(p).block_color_map()
    assert bcs.build_block_texture_map(p) is bcs.get_block_color_service(p).block_texture_map()
    assert (
        bcs.build_block_meta_texture_map(p)
        is bcs.get_block_color_service(p).block_meta_texture_map()
    )


def test_old_module_level_caches_are_gone() -> None:
    # Encapsulation guarantee: the per-world global caches no longer exist.
    for name in (
        "_color_cache",
        "_texture_key_cache",
        "_meta_texture_key_cache",
        "_asset_db_cache",
        "_texture_colors_cache",
        "_asset_db_lock",
    ):
        assert not hasattr(bcs, name), f"{name} should no longer be a module global"
