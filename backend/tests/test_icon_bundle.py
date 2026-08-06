import gzip
import json
from pathlib import Path
from typing import Any

import pytest

from app.services import pack_version
from app.services.blockcolor import dump_resolver, resolution
from app.services.blockcolor.dump_resolver import ForgeDumpResolver

ICON_DUMP = {
    "format": "atlas-gtnh-icon-dump-v1",
    "mods": ["gregtech_nh@5.09.51.470"],
    "blocks": {"minecraft:grass": {"0": {"1": "grass_top"}}},
}


def _write_gz(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(obj, f)


def test_resolver_loads_gzipped_dump(tmp_path: Path) -> None:
    gz = tmp_path / "icon_dump.json.gz"
    _write_gz(gz, ICON_DUMP)
    r = ForgeDumpResolver()
    assert r.load(gz) is True
    assert r.block_count == 1
    res = r.resolve("minecraft:grass", 0)
    assert res.resolved and res.texture_key == "grass_top"


def test_resolver_still_loads_plain_json(tmp_path: Path) -> None:
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


def test_bundled_icon_dump_selects_major(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = _bundle(tmp_path)
    monkeypatch.setattr(resolution, "_DATA_DIR", data)
    monkeypatch.setattr(
        pack_version, "read_world_modlist", lambda _p: {"gregtech_nh": "5.09.51.470"}
    )
    cand = resolution._bundled_icon_dump("world")
    assert cand == data / "2.8" / "icon_dump.json.gz"


def test_bundled_icon_dump_prefers_gz_but_falls_back_to_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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


def test_bundled_icon_dump_none_without_world(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(resolution, "_DATA_DIR", tmp_path / "data")
    assert resolution._bundled_icon_dump(None) is None
    assert resolution._bundled_icon_dump("") is None


def _write_dump(path: Path, icon: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": "atlas-gtnh-icon-dump-v1",
        "blocks": {"example:block": {"0": {"1": icon}}},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def _reset_dump_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dump_resolver, "_resolver", ForgeDumpResolver())
    monkeypatch.setattr(resolution, "_manual_dump_path", None)
    monkeypatch.setattr(resolution, "_failed_dump_identities", set())
    monkeypatch.delenv("ATLAS_ICON_DUMP_PATH", raising=False)


def test_auto_dump_switches_with_world_and_keeps_old_snapshot_stable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _reset_dump_state(monkeypatch)
    instance_a = tmp_path / "instance-a"
    instance_b = tmp_path / "instance-b"
    dump_a = instance_a / "config" / "atlas" / "icon_dump.json"
    dump_b = instance_b / "config" / "atlas" / "icon_dump.json"
    _write_dump(dump_a, "example:a")
    _write_dump(dump_b, "example:b")

    resolution._try_auto_load_dump(instance_a, str(instance_a / "saves" / "world"))
    snapshot_a = dump_resolver.get_dump_resolver()
    assert snapshot_a.resolve("example:block").texture_key == "example:a"

    resolution._try_auto_load_dump(instance_b, str(instance_b / "saves" / "world"))
    snapshot_b = dump_resolver.get_dump_resolver()
    assert snapshot_b is not snapshot_a
    assert snapshot_b.resolve("example:block").texture_key == "example:b"
    assert snapshot_a.resolve("example:block").texture_key == "example:a"


def test_manual_dump_remains_the_candidate_during_map_rebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _reset_dump_state(monkeypatch)
    instance = tmp_path / "instance"
    automatic = instance / "config" / "atlas" / "icon_dump.json"
    manual = tmp_path / "manual.json"
    _write_dump(automatic, "example:auto")
    _write_dump(manual, "example:manual")

    assert resolution.load_manual_dump(manual)
    resolution._try_auto_load_dump(instance, str(instance / "saves" / "world"))

    active = dump_resolver.get_dump_resolver()
    assert active.identity == str(manual.resolve())
    assert active.resolve("example:block").texture_key == "example:manual"


def test_world_without_candidate_does_not_reuse_previous_dump(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _reset_dump_state(monkeypatch)
    previous = tmp_path / "previous.json"
    _write_dump(previous, "example:previous")
    assert dump_resolver.try_load_dump(previous)
    monkeypatch.setattr(resolution, "_dump_candidate", lambda _mc, _world: None)

    resolution._try_auto_load_dump(None, str(tmp_path / "other-world"))

    assert not dump_resolver.get_dump_resolver().is_loaded
