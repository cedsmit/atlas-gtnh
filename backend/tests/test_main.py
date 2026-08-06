from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.worlds import dump as dump_api
from app.api.worlds import lifecycle
from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_scan_progress_idle_for_unscanned_world() -> None:
    # An unknown world has never been scanned, so the tracker reports idle.
    response = client.get("/worlds/scan-progress", params={"world_path": "C:/nope"})
    assert response.status_code == 200
    assert response.json() == {"total": 0, "scanned": 0, "current": "", "done": True}


def test_close_world_evicts_maps_and_its_texture_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str | None]] = []

    def evict(world: str) -> str:
        calls.append(("evict", world))
        return "pack-a"

    monkeypatch.setattr(
        lifecycle,
        "evict_block_color_service",
        evict,
    )
    monkeypatch.setattr(
        lifecycle,
        "clear_texture_cache",
        lambda scope=None: calls.append(("textures", scope)),
    )

    response = client.delete("/worlds/close", params={"world_path": "C:/world-a"})

    assert response.status_code == 204
    assert calls == [("evict", "C:/world-a"), ("textures", "pack-a")]


def test_manual_dump_load_invalidates_maps_and_texture_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    dump_path = tmp_path / "icon_dump.json"
    dump_path.write_text("{}", encoding="utf-8")
    invalidations: list[str] = []
    monkeypatch.setattr(dump_api, "load_manual_dump", lambda _path: True)
    monkeypatch.setattr(
        dump_api,
        "clear_block_color_services",
        lambda: invalidations.append("maps"),
    )
    monkeypatch.setattr(
        dump_api,
        "clear_texture_cache",
        lambda: invalidations.append("textures"),
    )

    response = client.post("/worlds/load-dump", json={"path": str(dump_path)})

    assert response.status_code == 200
    assert invalidations == ["maps", "textures"]
