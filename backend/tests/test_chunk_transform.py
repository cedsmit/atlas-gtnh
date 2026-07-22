"""Chunk-record transforms: the NBT half of a rotated paste.

The test that earns its keep is :func:`test_tile_entity_follows_its_block`. A
tile entity stores absolute coordinates while its block lives in a chunk-local
array, so the two are rotated by different code paths. If they drift apart the
save still loads — the machine is simply somewhere the block is not, which
Minecraft resolves by dropping it. That is silent, and it happens after the
write.
"""

import gzip
import io
import struct
import zlib

import nbtlib
import numpy as np
import pytest
from nbtlib import ByteArray, Compound, Double, Int, List, String

from app.world.chunk_transform import remap_chunk_record

MARKER = 200  # a block id nothing else in the fixture uses


def _nibbles(values: list[int]) -> ByteArray:
    lo = np.array(values[0::2], dtype=np.uint8) & 0xF
    hi = np.array(values[1::2], dtype=np.uint8) & 0xF
    return ByteArray(np.frombuffer((lo | (hi << 4)).tobytes(), dtype=np.int8).tolist())


def _chunk(cx: int, cz: int, lx: int, lz: int, y: int = 5) -> bytes:
    """A chunk whose only marked block sits at local (lx, lz), with a tile
    entity and an entity standing on exactly that block."""
    blocks = np.zeros(4096, dtype=np.uint8)
    data = [0] * 4096
    idx = (y % 16) * 256 + lz * 16 + lx
    blocks[idx] = MARKER
    data[idx] = 3  # a metadata value we can follow

    level = Compound(
        {
            "xPos": Int(cx),
            "zPos": Int(cz),
            "Sections": List[Compound](
                [
                    Compound(
                        {
                            "Y": Int(y // 16),
                            "Blocks": ByteArray(
                                np.frombuffer(blocks.tobytes(), dtype=np.int8).tolist()
                            ),
                            "Data": _nibbles(data),
                        }
                    )
                ]
            ),
            "Biomes": ByteArray([0] * 256),
            "TileEntities": List[Compound](
                [
                    Compound(
                        {
                            "x": Int(cx * 16 + lx),
                            "y": Int(y),
                            "z": Int(cz * 16 + lz),
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
                                [
                                    Double(cx * 16 + lx + 0.5),
                                    Double(y + 1),
                                    Double(cz * 16 + lz + 0.5),
                                ]
                            ),
                            "Rotation": List[nbtlib.Float]([nbtlib.Float(0.0), nbtlib.Float(0.0)]),
                        }
                    )
                ]
            ),
        }
    )
    buf = io.BytesIO()
    nbtlib.File({"Level": level}).write(buf, byteorder="big")
    payload = zlib.compress(buf.getvalue())
    return struct.pack(">I", len(payload) + 1) + b"\x02" + payload


def _parse(record: bytes) -> Compound:
    length = struct.unpack_from(">I", record, 0)[0]
    payload = record[5 : 4 + length]
    raw = gzip.decompress(payload) if record[4] == 1 else zlib.decompress(payload)
    return nbtlib.File.parse(io.BytesIO(raw), byteorder="big")["Level"]


def _marker_local(level: Compound) -> tuple[int, int]:
    blocks = np.asarray(level["Sections"][0]["Blocks"], dtype=np.int8).astype(np.uint8)
    idx = int(np.flatnonzero(blocks == MARKER)[0])
    return idx % 16, (idx // 16) % 16


@pytest.mark.parametrize("turn", [0, 90, 180, 270])
@pytest.mark.parametrize("lx,lz", [(0, 0), (15, 0), (3, 11), (15, 15)])
def test_tile_entity_follows_its_block(turn: int, lx: int, lz: int) -> None:
    """Block, tile entity and entity must land on the same column."""
    src_cx, src_cz = 2, -3
    dst_cx, dst_cz = 40, 17
    # turn=0 is the pure-shift path and takes its positions from the offset;
    # a turn derives them from the destination instead.
    dx, dz = ((dst_cx - src_cx) * 16, (dst_cz - src_cz) * 16) if turn == 0 else (0, 0)
    out = remap_chunk_record(_chunk(src_cx, src_cz, lx, lz), dst_cx, dst_cz, dx, dz, turn=turn)
    level = _parse(out)

    bx, bz = _marker_local(level)
    te = level["TileEntities"][0]
    assert (int(te["x"]), int(te["z"])) == (dst_cx * 16 + bx, dst_cz * 16 + bz)

    pos = level["Entities"][0]["Pos"]
    assert int(float(pos[0])) == dst_cx * 16 + bx
    assert int(float(pos[2])) == dst_cz * 16 + bz


@pytest.mark.parametrize("turn", [90, 180, 270])
def test_metadata_travels_with_its_block(turn: int) -> None:
    """The Data nibble must be permuted the same way as Blocks, or every
    directional block ends up wearing a neighbour's orientation."""
    level = _parse(remap_chunk_record(_chunk(0, 0, 4, 9), 7, 7, 0, 0, turn=turn))
    bx, bz = _marker_local(level)
    raw = np.asarray(level["Sections"][0]["Data"], dtype=np.int8).astype(np.uint8)
    idx = (5 % 16) * 256 + bz * 16 + bx
    nibble = raw[idx // 2] & 0xF if idx % 2 == 0 else (raw[idx // 2] >> 4) & 0xF
    assert nibble == 3


def test_entity_yaw_turns_with_the_world() -> None:
    """An entity facing south (yaw 0) faces west (yaw 90) after a clockwise turn."""
    level = _parse(remap_chunk_record(_chunk(0, 0, 8, 8), 0, 0, 0, 0, turn=90))
    assert float(level["Entities"][0]["Rotation"][0]) == pytest.approx(90.0)


def test_offset_paste_is_unchanged_by_the_rotation_work() -> None:
    """turn=0 must still be a pure shift, the path every existing paste uses."""
    level = _parse(remap_chunk_record(_chunk(0, 0, 4, 9), 3, 5, 48, 80))
    te = level["TileEntities"][0]
    assert (int(te["x"]), int(te["z"])) == (4 + 48, 9 + 80)
    assert _marker_local(level) == (4, 9)  # blocks untouched
