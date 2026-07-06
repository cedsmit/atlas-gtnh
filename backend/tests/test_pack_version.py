import json

from app.services import pack_version

SIGS = {
    "2.8": {"gregtech_nh": "5.09.51.470", "gtnhlib": "0.6.40", "gtnhmixins": "2.2.0"},
    "2.9": {"gregtech_nh": "5.10.00.999", "gtnhlib": "0.7.10", "gtnhmixins": "2.4.0"},
}


def _patch_modlist(monkeypatch, mods):
    monkeypatch.setattr(pack_version, "read_world_modlist", lambda _p: mods)


def test_no_signatures_returns_none(monkeypatch):
    _patch_modlist(monkeypatch, {"gregtech_nh": "5.09.51.470"})
    assert pack_version.detect_gtnh_major("w", {}) is None


def test_picks_matching_major(monkeypatch):
    _patch_modlist(monkeypatch, {"gregtech_nh": "5.09.51.470", "gtnhlib": "0.6.40"})
    assert pack_version.detect_gtnh_major("w", SIGS) == "2.8"


def test_picks_newer_major(monkeypatch):
    _patch_modlist(monkeypatch, {"gregtech_nh": "5.10.00.999", "gtnhmixins": "2.4.0"})
    assert pack_version.detect_gtnh_major("w", SIGS) == "2.9"


def test_anchor_match_is_case_insensitive(monkeypatch):
    _patch_modlist(monkeypatch, {"GregTech_NH": "5.09.51.470"})
    assert pack_version.detect_gtnh_major("w", SIGS) == "2.8"


def test_empty_modlist_falls_back_to_newest(monkeypatch):
    _patch_modlist(monkeypatch, {})
    assert pack_version.detect_gtnh_major("w", SIGS) == "2.9"


def test_unknown_versions_fall_back_to_newest(monkeypatch):
    _patch_modlist(monkeypatch, {"gregtech_nh": "99.99"})  # matches neither major
    assert pack_version.detect_gtnh_major("w", SIGS) == "2.9"


def test_single_major_always_that_major(monkeypatch):
    _patch_modlist(monkeypatch, {"gregtech_nh": "5.10.00.999"})  # a 2.9-ish world
    assert pack_version.detect_gtnh_major("w", {"2.8": SIGS["2.8"]}) == "2.8"


def test_load_major_signatures(tmp_path):
    d = tmp_path / "2.8"
    d.mkdir()
    (d / "biome_dump.json").write_text(
        json.dumps({"mods": ["gregtech_nh@5.09.51.470", "gtnhlib@0.6.40"], "biomes": {}}),
        encoding="utf-8",
    )
    (tmp_path / "empty").mkdir()  # a dir without the dump is skipped
    sigs = pack_version.load_major_signatures(tmp_path, "biome_dump.json")
    assert sigs == {"2.8": {"gregtech_nh": "5.09.51.470", "gtnhlib": "0.6.40"}}


def test_load_major_signatures_missing_dir(tmp_path):
    assert pack_version.load_major_signatures(tmp_path / "nope") == {}
