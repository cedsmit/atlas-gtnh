from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_world(tmp: Path) -> Path:
    world = tmp / "test_world"
    world.mkdir()
    (world / "level.dat").touch()
    region = world / "region"
    region.mkdir()
    (region / "r.0.0.mca").touch()
    return world


def test_validate_valid_world(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.post("/worlds/validate", json={"path": str(world)})
    assert response.status_code == 200
    assert response.json() == {"valid": True, "error": None}


def test_validate_missing_level_dat(tmp_path: Path) -> None:
    world = tmp_path / "no_level"
    world.mkdir()
    (world / "region").mkdir()
    response = client.post("/worlds/validate", json={"path": str(world)})
    data = response.json()
    assert data["valid"] is False
    assert "level.dat" in data["error"]


def test_validate_no_region_files(tmp_path: Path) -> None:
    world = tmp_path / "empty_region"
    world.mkdir()
    (world / "level.dat").touch()
    (world / "region").mkdir()
    response = client.post("/worlds/validate", json={"path": str(world)})
    data = response.json()
    assert data["valid"] is False
    assert "region" in data["error"]


def test_validate_nonexistent_path() -> None:
    response = client.post("/worlds/validate", json={"path": "/nonexistent/path/to/world"})
    data = response.json()
    assert data["valid"] is False
    assert data["error"] is not None


def test_validate_not_a_directory(tmp_path: Path) -> None:
    file = tmp_path / "not_a_dir.txt"
    file.touch()
    response = client.post("/worlds/validate", json={"path": str(file)})
    data = response.json()
    assert data["valid"] is False
    assert "folder" in data["error"].lower()
