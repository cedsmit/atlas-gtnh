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


def test_copy_rotates_the_selection_footprint(tmp_path: Path) -> None:
    """A quarter turn swaps the footprint: a 1x3 strip pastes as 3x1.

    The chunk that was at the strip's far end must come back at the far end of
    the turned strip, not simply offset — that is the difference between turning
    a selection and shifting it.
    """
    src = tmp_path / "src"
    for cz in range(3):
        _write_nbt_chunk(src, 0, cz)  # a 1-wide, 3-tall strip

    result = copy_chunks(
        str(src), str(tmp_path / "dst"), [(0, 0), (0, 1), (0, 2)], (10, 10), turn=90
    )

    assert result["copied"] == 3
    dst = tmp_path / "dst"
    # cw90 on a 1x3 box gives a 3x1 box; (0,j) -> (height-1-j, 0).
    assert _has_chunk(dst, 10 + 2, 10 + 0)  # j=0 -> far end
    assert _has_chunk(dst, 10 + 1, 10 + 0)
    assert _has_chunk(dst, 10 + 0, 10 + 0)  # j=2 -> near end
    assert not _has_chunk(dst, 10 + 0, 10 + 1)  # nothing left in the old shape


def test_rotated_copy_reports_what_it_guessed(tmp_path: Path) -> None:
    """A turn returns a rotation report; a plain offset paste does not."""
    src = tmp_path / "src"
    _write_nbt_chunk(src, 0, 0)

    turned = copy_chunks(str(src), str(tmp_path / "a"), [(0, 0)], (5, 5), turn=180)
    assert "rotation" in turned
    assert turned["rotation"]["turn"] == 180  # type: ignore[index]

    plain = copy_chunks(str(src), str(tmp_path / "b"), [(0, 0)], (5, 5))
    assert "rotation" not in plain


def test_same_world_rotation_in_place_is_allowed(tmp_path: Path) -> None:
    """Turning a selection where it stands changes it, so it is not the no-op
    that a zero-offset copy would be."""
    src = tmp_path / "w"
    _write_nbt_chunk(src, 0, 0)
    _write_nbt_chunk(src, 1, 0)
    copy_chunks(str(src), str(src), [(0, 0), (1, 0)], (0, 0), turn=90)  # must not raise


def _blocks_chunk(cx: int, cz: int, marks: list[tuple[int, int]]) -> bytes:
    """A chunk whose y=0 layer has stone at each (x, z) in *marks*."""
    blocks = bytearray(4096)
    for x, z in marks:
        blocks[z * 16 + x] = 1  # y=0 => index is z*16 + x
    level = Compound(
        {
            "xPos": Int(cx),
            "zPos": Int(cz),
            "Sections": List[Compound](
                [
                    Compound(
                        {
                            "Y": nbtlib.Byte(0),
                            "Blocks": nbtlib.ByteArray([b - 256 if b > 127 else b for b in blocks]),
                        }
                    )
                ]
            ),
            "TileEntities": List[Compound]([]),
            "Entities": List[Compound]([]),
        }
    )
    buf = io.BytesIO()
    nbtlib.File({"Level": level}).write(buf, byteorder="big")
    return buf.getvalue()


def _blocks_at(dim: Path, cx: int, cz: int) -> list[tuple[int, int]]:
    rec = read_region_records(dim / "region" / f"r.{cx >> 5}.{cz >> 5}.mca")[
        local_index(cx % 32, cz % 32)
    ][0]
    length = struct.unpack_from(">I", rec, 0)[0]
    level = nbtlib.File.parse(io.BytesIO(zlib.decompress(rec[5 : 4 + length])), byteorder="big")[
        "Level"
    ]
    raw = level["Sections"][0]["Blocks"]
    return sorted((x, z) for z in range(16) for x in range(16) if int(raw[z * 16 + x]) != 0)


def test_rotated_copy_actually_turns_the_block_contents(tmp_path: Path) -> None:
    """The blocks inside a chunk move, not just the chunk's place in the grid.

    Everything else about rotation was covered — the footprint, the metadata,
    the tile entities — but nothing asserted that a turned paste rewrites the
    block array itself. That is the part a user sees, and it is the part that
    silently did nothing when an older server ignored the "turn" field.
    """
    src, dst = tmp_path / "src", tmp_path / "dst"
    (src / "region").mkdir(parents=True)
    (dst / "region").mkdir(parents=True)
    # An L, so no symmetry can make a wrong turn look right.
    marks = [(0, 0), (0, 1), (0, 2), (1, 0)]
    _write_chunk(src, 0, 0, _blocks_chunk(0, 0, marks))

    copy_chunks(str(src), str(dst), [(0, 0)], (0, 0), 90)

    # A quarter turn clockwise sends (x, z) to (15 - z, x).
    assert _blocks_at(dst, 0, 0) == sorted((15 - z, x) for x, z in marks)


def test_copy_rejects_unknown_fields_rather_than_ignoring_them(tmp_path: Path) -> None:
    """A client sending a field this server does not know must fail loudly.

    Pydantic ignores extras by default, which is how a rotation request reached
    a server that predated rotation, got dropped, and still reported success.
    """
    resp = client.post(
        "/worlds/chunks/copy",
        json={
            "src_world": str(tmp_path),
            "dst_world": str(tmp_path / "other"),
            "chunks": [[0, 0]],
            "offset": [1, 0],
            "somethingThisServerDoesNotKnow": 90,
        },
    )
    assert resp.status_code == 422
