import io
import struct
import zlib
from pathlib import Path

import nbtlib
import pytest
from fastapi.testclient import TestClient
from nbtlib import Compound, Double, Int, List, String

from app.main import app
from app.services.chunk_ops_service import (
    copy_chunks,
    create_world,
    delete_chunks,
    delete_chunks_except,
)
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


def _write_nbt_chunk(dim: Path, cx: int, cz: int) -> None:
    """Write a chunk with a real (minimal) NBT payload for offset-remap tests."""
    level = Compound(
        {
            "xPos": Int(cx),
            "zPos": Int(cz),
            "TileEntities": List[Compound](
                [
                    Compound(
                        {
                            "x": Int(cx * 16 + 2),
                            "y": Int(64),
                            "z": Int(cz * 16 + 3),
                            "id": String("Chest"),
                        }
                    )
                ]
            ),
            "Entities": List[Compound](
                [
                    Compound(
                        {
                            "Pos": List[Double](
                                [Double(cx * 16 + 1.5), Double(70.0), Double(cz * 16 + 4.5)]
                            )
                        }
                    )
                ]
            ),
        }
    )
    buf = io.BytesIO()
    nbtlib.File({"Level": level}).write(buf, byteorder="big")
    path = dim / "region" / f"r.{cx >> 5}.{cz >> 5}.mca"
    records = read_region_records(path)
    records[local_index(cx % 32, cz % 32)] = (make_record(buf.getvalue()), 1)
    write_region_records(path, records)


def _read_level(dim: Path, cx: int, cz: int) -> Compound:
    path = dim / "region" / f"r.{cx >> 5}.{cz >> 5}.mca"
    rec, _ = read_region_records(path)[local_index(cx % 32, cz % 32)]
    length = struct.unpack_from(">I", rec, 0)[0]
    raw = zlib.decompress(rec[5 : 4 + length])
    return nbtlib.File.parse(io.BytesIO(raw), byteorder="big")["Level"]


def test_delete_chunks_service(tmp_path: Path) -> None:
    dim = tmp_path / "world"
    _write_chunk(dim, 5, 5, b"keep" * 100)
    _write_chunk(dim, 6, 6, b"drop" * 100)

    result = delete_chunks(str(dim), [(6, 6), (99, 99)])  # one present, one absent
    assert result["deleted"] == 1
    assert result["missing"] == 1
    assert _has_chunk(dim, 5, 5)
    assert not _has_chunk(dim, 6, 6)


def test_delete_chunks_except_service(tmp_path: Path) -> None:
    dim = tmp_path / "world"
    _write_chunk(dim, 5, 5, b"base" * 100)  # keep
    _write_chunk(dim, 6, 6, b"other" * 100)  # same region, delete
    _write_chunk(dim, 40, 40, b"far" * 100)  # different region, delete

    result = delete_chunks_except(str(dim), [(5, 5)])
    assert result["deleted"] == 2
    assert result["kept"] == 1
    assert _has_chunk(dim, 5, 5)
    assert not _has_chunk(dim, 6, 6)
    assert not _has_chunk(dim, 40, 40)


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


def test_copy_offset_remaps_coords(tmp_path: Path) -> None:
    src = tmp_path / "src"
    _write_nbt_chunk(src, 5, 5)
    # Same-world paste shifted +2 chunks x, +3 chunks z → dest chunk (7, 8).
    result = copy_chunks(str(src), str(src), [(5, 5)], offset=(2, 3))
    assert result["copied"] == 1

    lv = _read_level(src, 7, 8)
    assert int(lv["xPos"]) == 7
    assert int(lv["zPos"]) == 8
    assert int(lv["TileEntities"][0]["x"]) == 5 * 16 + 2 + 2 * 16
    assert int(lv["TileEntities"][0]["z"]) == 5 * 16 + 3 + 3 * 16
    assert float(lv["Entities"][0]["Pos"][0]) == 5 * 16 + 1.5 + 2 * 16
    assert float(lv["Entities"][0]["Pos"][2]) == 5 * 16 + 4.5 + 3 * 16
    # source chunk untouched
    assert int(_read_level(src, 5, 5)["xPos"]) == 5


def test_create_world_clones_level_dat(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    (src / "level.dat").write_bytes(b"LEVELDATA")
    _write_nbt_chunk(src, 5, 5)

    new = tmp_path / "newworld"
    result = create_world(str(src), str(new), [(5, 5)])
    assert result["copied"] == 1
    assert (new / "level.dat").read_bytes() == b"LEVELDATA"
    assert _has_chunk(new, 5, 5)


def test_create_world_refuses_nonempty(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    (src / "level.dat").write_bytes(b"L")
    _write_nbt_chunk(src, 0, 0)
    new = tmp_path / "existing"
    new.mkdir()
    (new / "something").write_text("x")
    with pytest.raises(ValueError):
        create_world(str(src), str(new), [(0, 0)])


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
