import json
from pathlib import Path

import pytest

from app.services import biome_color_service, pack_version


def _write_dump(
    path: Path, biomes: dict[str, dict[str, int]], mods: list[str] | None = None
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"mods": mods or [], "biomes": biomes}), encoding="utf-8")


def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, major: str = "2.8") -> Path:
    """Bundle data/<major>/biome_dump.json under a tmp data dir and isolate env/home."""
    data_dir = tmp_path / "data"
    _write_dump(
        data_dir / major / "biome_dump.json",
        {"113": {"grass": 0x4DA94C, "foliage": 0x3EA924}},
        mods=["gregtech_nh@5.09.51.470"],
    )
    monkeypatch.setattr(biome_color_service, "_DATA_DIR", data_dir)
    monkeypatch.setattr(
        pack_version, "read_world_modlist", lambda _p: {"gregtech_nh": "5.09.51.470"}
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "fakehome")
    monkeypatch.delenv("ATLAS_BIOME_DUMP_PATH", raising=False)
    biome_color_service._cache.clear()
    return data_dir


def test_bundled_default_used_when_no_instance_dump(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _setup(monkeypatch, tmp_path)
    colors = biome_color_service.get_biome_colors(str(tmp_path / "world"))
    assert colors[113] == {"grass": [77, 169, 76], "foliage": [62, 169, 36]}


def test_bundled_result_not_cached(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)
    w = str(tmp_path / "world")
    biome_color_service.get_biome_colors(w)
    # A bundled default must NOT be cached, so a per-instance dump can supersede it live.
    assert w not in biome_color_service._cache


def test_instance_dump_overrides_bundled(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _setup(monkeypatch, tmp_path)
    world = tmp_path / "inst" / "world"
    _write_dump(
        tmp_path / "inst" / "config" / "atlas" / "biome_dump.json",
        {"113": {"grass": 0x000000, "foliage": 0x000000}},
    )
    colors = biome_color_service.get_biome_colors(str(world))
    assert colors[113] == {"grass": [0, 0, 0], "foliage": [0, 0, 0]}  # instance wins


def test_no_dump_anywhere_returns_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Empty data dir → no bundled major → and no instance/home dump → {}
    monkeypatch.setattr(biome_color_service, "_DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(pack_version, "read_world_modlist", lambda _p: {})
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "fakehome")
    monkeypatch.delenv("ATLAS_BIOME_DUMP_PATH", raising=False)
    biome_color_service._cache.clear()
    assert biome_color_service.get_biome_colors(str(tmp_path / "world")) == {}
