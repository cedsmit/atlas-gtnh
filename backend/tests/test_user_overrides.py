import json

from fastapi.testclient import TestClient

from app.main import app
from app.services import user_overrides

EMPTY = {"format": 1, "source": "authored", "blocks": {}}

client = TestClient(app)


def _patch_path(monkeypatch, tmp_path):
    p = tmp_path / "user-overrides.json"
    monkeypatch.setattr(user_overrides, "_PATH", p)
    return p


def test_load_empty_when_missing(monkeypatch, tmp_path):
    _patch_path(monkeypatch, tmp_path)
    assert user_overrides.load_overrides() == EMPTY


def test_upsert_writes_and_loads(monkeypatch, tmp_path):
    p = _patch_path(monkeypatch, tmp_path)
    user_overrides.upsert_override(
        "Botania:manaGlass", {"category": "transparent", "tint": "foliage"}
    )
    on_disk = json.loads(p.read_text(encoding="utf-8"))
    assert on_disk["blocks"]["Botania:manaGlass"] == {
        "category": "transparent",
        "tint": "foliage",
    }
    assert (
        user_overrides.load_overrides()["blocks"]["Botania:manaGlass"]["category"] == "transparent"
    )


def test_upsert_drops_unknown_keys(monkeypatch, tmp_path):
    _patch_path(monkeypatch, tmp_path)
    data = user_overrides.upsert_override(
        "mod:block", {"category": "solid", "evil": "x", "tint": "grass"}
    )
    assert data["blocks"]["mod:block"] == {"category": "solid", "tint": "grass"}


def test_upsert_replaces(monkeypatch, tmp_path):
    _patch_path(monkeypatch, tmp_path)
    user_overrides.upsert_override("mod:b", {"category": "solid"})
    user_overrides.upsert_override("mod:b", {"category": "overlay"})
    assert user_overrides.load_overrides()["blocks"]["mod:b"] == {"category": "overlay"}


def test_remove(monkeypatch, tmp_path):
    _patch_path(monkeypatch, tmp_path)
    user_overrides.upsert_override("mod:b", {"category": "solid"})
    user_overrides.remove_override("mod:b")
    assert "mod:b" not in user_overrides.load_overrides()["blocks"]
    user_overrides.remove_override("mod:nope")  # no-op, no error


def test_corrupt_file_returns_empty(monkeypatch, tmp_path):
    p = _patch_path(monkeypatch, tmp_path)
    p.write_text("{ not valid json", encoding="utf-8")
    assert user_overrides.load_overrides() == EMPTY


def test_file_deleted_when_last_override_removed(monkeypatch, tmp_path):
    p = _patch_path(monkeypatch, tmp_path)
    user_overrides.upsert_override("mod:a", {"category": "solid"})
    user_overrides.upsert_override("mod:b", {"category": "overlay"})
    assert p.exists()
    user_overrides.remove_override("mod:a")
    assert p.exists()  # one override still left
    user_overrides.remove_override("mod:b")
    assert not p.exists()  # last override gone → no stray empty file
    assert user_overrides.load_overrides() == EMPTY  # load still graceful


def test_endpoints_round_trip(monkeypatch, tmp_path):
    _patch_path(monkeypatch, tmp_path)

    assert client.get("/worlds/render-overrides").json()["blocks"] == {}

    r = client.post(
        "/worlds/render-overrides",
        json={
            "name": "Botania:manaGlass",
            "definition": {"category": "transparent", "tint": "foliage", "evil": 1},
        },
    )
    assert r.status_code == 200
    assert r.json()["blocks"]["Botania:manaGlass"] == {
        "category": "transparent",
        "tint": "foliage",
    }  # unknown key dropped

    # invalid category rejected
    bad = client.post(
        "/worlds/render-overrides",
        json={"name": "x", "definition": {"category": "bogus"}},
    )
    assert bad.status_code == 400

    # GET reflects the saved override
    assert "Botania:manaGlass" in client.get("/worlds/render-overrides").json()["blocks"]

    # DELETE removes it
    d = client.request("DELETE", "/worlds/render-overrides", params={"name": "Botania:manaGlass"})
    assert d.status_code == 200
    assert "Botania:manaGlass" not in d.json()["blocks"]
