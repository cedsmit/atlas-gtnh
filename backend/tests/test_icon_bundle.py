import gzip
import json
from pathlib import Path

from app.services import pack_version
from app.services.blockcolor import resolution
from app.services.blockcolor.dump_resolver import ForgeDumpResolver

ICON_DUMP = {
    "format": "atlas-gtnh-icon-dump-v1",
    "mods": ["gregtech_nh@5.09.51.470"],
    "blocks": {"minecraft:grass": {"0": {"1": "grass_top"}}},
}


def _write_gz(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f)


def test_resolver_loads_gzipped_dump(tmp_path):
    gz = tmp_path / "icon_dump.json.gz"
    _write_gz(gz, ICON_DUMP)
    r = ForgeDumpResolver()
    assert r.load(gz) is True
    assert r.block_count == 1
    res = r.resolve("minecraft:grass", 0)
    assert res.resolved and res.texture_key == "grass_top"


def test_resolver_still_loads_plain_json(tmp_path):
    p = tmp_path / "icon_dump.json"
    p.write_text(json.dumps(ICON_DUMP), encoding="utf-8")
    r = ForgeDumpResolver()
    assert r.load(p) is True
    assert r.resolve("minecraft:grass", 0).texture_key == "grass_top"


def _bundle(tmp_path: Path, major: str = "2.8") -> Path:
    """Bundle data/<major>/ with the biome-dump signature + gzipped icon dump."""
    data = tmp_path / "data"
    (data / major).mkdir(parents=True)
    (data / major / "biome_dump.json").write_text(
        json.dumps({"mods": ["gregtech_nh@5.09.51.470"], "biomes": {}}), encoding="utf-8"
    )
    _write_gz(data / major / "icon_dump.json.gz", ICON_DUMP)
    return data


def test_bundled_icon_dump_selects_major(tmp_path, monkeypatch):
    data = _bundle(tmp_path)
    monkeypatch.setattr(resolution, "_DATA_DIR", data)
    monkeypatch.setattr(
        pack_version, "read_world_modlist", lambda _p: {"gregtech_nh": "5.09.51.470"}
    )
    cand = resolution._bundled_icon_dump("world")
    assert cand == data / "2.8" / "icon_dump.json.gz"


def test_bundled_icon_dump_prefers_gz_but_falls_back_to_json(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "2.8").mkdir(parents=True)
    (data / "2.8" / "biome_dump.json").write_text(
        json.dumps({"mods": ["gregtech_nh@5.09.51.470"], "biomes": {}}), encoding="utf-8"
    )
    (data / "2.8" / "icon_dump.json").write_text(json.dumps(ICON_DUMP), encoding="utf-8")
    monkeypatch.setattr(resolution, "_DATA_DIR", data)
    monkeypatch.setattr(
        pack_version, "read_world_modlist", lambda _p: {"gregtech_nh": "5.09.51.470"}
    )
    assert resolution._bundled_icon_dump("world") == data / "2.8" / "icon_dump.json"


def test_bundled_icon_dump_none_without_world(tmp_path, monkeypatch):
    monkeypatch.setattr(resolution, "_DATA_DIR", tmp_path / "data")
    assert resolution._bundled_icon_dump(None) is None
    assert resolution._bundled_icon_dump("") is None
