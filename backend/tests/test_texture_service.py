from pathlib import Path

import pytest

from app.services import texture_service


def test_batch_resolves_all_cache_misses_in_one_lookup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    jar = tmp_path / "textures.jar"
    jar.touch()
    lookups: list[list[str]] = []

    def resolve(keys: list[str], _allowed: object) -> dict[str, str]:
        lookups.append(keys)
        return {"mod:a": str(jar), "mod:b": str(jar)}

    monkeypatch.setattr(texture_service, "get_texture_source_jars", resolve)
    monkeypatch.setattr(
        texture_service,
        "_read_keys_from_jar",
        lambda _jar, keys: {key: key.encode() for key in keys},
    )
    texture_service.clear_texture_cache()

    assert texture_service.get_textures_batch(["mod:a", "mod:b"]) == {
        "mod:a": b"mod:a",
        "mod:b": b"mod:b",
    }
    assert lookups == [["mod:a", "mod:b"]]
    texture_service.clear_texture_cache()


def test_texture_cache_is_scoped_per_pack(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        texture_service,
        "_texture_context",
        lambda world: (str(world), (str(world),)),
    )
    monkeypatch.setattr(
        texture_service,
        "get_texture_source_jars",
        lambda keys, allowed: {key: allowed[0] for key in keys},
    )
    monkeypatch.setattr(
        texture_service,
        "_read_keys_from_jar",
        lambda jar, keys: {key: jar.encode() for key in keys},
    )
    texture_service.clear_texture_cache()

    assert texture_service.get_textures_batch(["mod:a"], "pack-a") == {"mod:a": b"pack-a"}
    assert texture_service.get_textures_batch(["mod:a"], "pack-b") == {"mod:a": b"pack-b"}

    texture_service.clear_texture_cache("pack-a")
    assert ("pack-a", "mod:a") not in texture_service._cache
    assert texture_service._cache[("pack-b", "mod:a")] == b"pack-b"
    texture_service.clear_texture_cache()
