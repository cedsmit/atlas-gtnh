from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.chunk_ops_service import copy_chunks, delete_chunks
from app.world.region_writer import (
    local_index,
    make_record,
    read_region_records,
    write_region_records,
)

client = TestClient(app)


def _write_chunk(dim: Path, cx: int, cz: int, payload: bytes, ts: int = 1) -> None:
    path = dim / "region" / f"r.{cx >> 5}.{cz >> 5}.mca"
    records = read_region_records(path)
    records[local_index(cx % 32, cz % 32)] = (make_record(payload), ts)
    write_region_records(path, records)


def _has_chunk(dim: Path, cx: int, cz: int) -> bool:
    path = dim / "region" / f"r.{cx >> 5}.{cz >> 5}.mca"
    return local_index(cx % 32, cz % 32) in read_region_records(path)


def test_delete_chunks_service(tmp_path: Path) -> None:
    dim = tmp_path / "world"
    _write_chunk(dim, 5, 5, b"keep" * 100)
    _write_chunk(dim, 6, 6, b"drop" * 100)

    result = delete_chunks(str(dim), [(6, 6), (99, 99)])  # one present, one absent
    assert result["deleted"] == 1
    assert result["missing"] == 1
    assert _has_chunk(dim, 5, 5)
    assert not _has_chunk(dim, 6, 6)


def test_copy_chunks_service(tmp_path: Path) -> None:
    src = tmp_path / "src"
    dst = tmp_path / "dst"
    _write_chunk(src, 5, 5, b"base-build" * 200, ts=77)

    result = copy_chunks(str(src), str(dst), [(5, 5), (100, 100)])
    assert result["copied"] == 1
    assert result["missing"] == 1
    assert _has_chunk(dst, 5, 5)
    # byte-exact transplant, timestamp preserved
    idx = local_index(5, 5)
    assert (
        read_region_records(dst / "region" / "r.0.0.mca")[idx]
        == read_region_records(src / "region" / "r.0.0.mca")[idx]
    )


def test_copy_rejects_same_world(tmp_path: Path) -> None:
    dim = tmp_path / "world"
    _write_chunk(dim, 0, 0, b"x" * 50)
    r = client.post(
        "/worlds/chunks/copy",
        json={"src_world": str(dim), "dst_world": str(dim), "chunks": [[0, 0]]},
    )
    assert r.status_code == 400


def test_delete_missing_world_is_ok(tmp_path: Path) -> None:
    r = client.post(
        "/worlds/chunks/delete",
        json={"world_path": str(tmp_path / "nope"), "chunks": [[0, 0], [1, 1]]},
    )
    assert r.status_code == 200
    assert r.json() == {"deleted": 0, "missing": 2, "regions": []}
