from fastapi.testclient import TestClient

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
