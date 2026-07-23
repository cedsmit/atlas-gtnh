"""Transform a chunk region record for an offset paste.

Same-coordinate copies transplant the compressed record verbatim. Pasting at a
different coordinate must rewrite the coordinates *inside* the chunk NBT: the
chunk's own ``xPos``/``zPos`` plus every block-position it stores — TileEntities,
Entities, and TileTicks — shifted by the paste offset. Blocks (Sections) use
chunk-local coords, so they need no change.

Uses nbtlib for correctness (volumes are small — a copied selection).
"""

from __future__ import annotations

import gzip
import io
import struct
import zlib

import nbtlib
import numpy as np
import numpy.typing as npt
from nbtlib import ByteArray, Double, Int

from app.world.chunk_orient import OrientReport, meta_lut, rotate_tile_entity
from app.world.chunk_rotate import (
    pack_bytes,
    pack_nibbles,
    pack_u16,
    rotate_columns,
    rotate_yzx,
    unpack_bytes,
    unpack_nibbles,
    unpack_u16,
)
from app.world.region_writer import make_record

#: Per-block section arrays, by the packing each uses. 4096 blocks per section.
_SECTION_ARRAYS = (
    ("Blocks", "byte"),  # vanilla ids, low 8 bits
    ("Add", "nibble"),  # vanilla ids, high 4 bits
    ("Data", "nibble"),  # vanilla metadata
    ("Blocks16", "u16"),  # GTNH wide ids
    ("Data16", "u16"),  # GTNH wide metadata
    ("SkyLight", "nibble"),
    ("BlockLight", "nibble"),
)

#: Per-column arrays (256 entries, ZX order).
_COLUMN_ARRAYS = ("Biomes", "Biomes16v2", "HeightMap")


def _as_bytes(value: object) -> bytes:
    """nbtlib byte arrays come back as signed ints; get at the raw bytes."""
    return np.asarray(value, dtype=np.int8).tobytes()


def _rotate_packed(raw: bytes, packing: str, turn: int, per_column: bool) -> bytes | None:
    """Rotate one packed array, or None if it is not the size we expect.

    A wrong-sized array means some mod stores something else under that name;
    leaving it alone is better than reshaping whatever it actually is.
    """
    count = 256 if per_column else 4096
    if packing == "nibble":
        if len(raw) != count // 2:
            return None
        values = unpack_nibbles(raw, count)
    elif packing == "u16":
        if len(raw) != count * 2:
            return None
        values = unpack_u16(raw)
    else:
        if len(raw) != count:
            return None
        values = unpack_bytes(raw)

    turned = rotate_columns(values, turn) if per_column else rotate_yzx(values, turn)

    if packing == "nibble":
        return pack_nibbles(turned)
    if packing == "u16":
        return pack_u16(turned)
    return pack_bytes(turned)


def _rotate_chunk_arrays(level: nbtlib.Compound, turn: int) -> None:
    """Turn every spatial array in the chunk: blocks, metadata, light, biomes."""
    for section in level.get("Sections") or []:
        for name, packing in _SECTION_ARRAYS:
            raw = section.get(name)
            if raw is None:
                continue
            out = _rotate_packed(_as_bytes(raw), packing, turn, per_column=False)
            if out is not None:
                section[name] = ByteArray(np.frombuffer(out, dtype=np.int8).tolist())

    for name in _COLUMN_ARRAYS:
        raw = level.get(name)
        if raw is None:
            continue
        # HeightMap is an IntArray; the byte-packed ones are biomes.
        if name == "HeightMap":
            values = np.asarray(raw, dtype=np.int64)
            if values.size != 256:
                continue
            level[name] = type(raw)(
                rotate_columns(values.astype(np.uint16), turn).astype(np.int64).tolist()
            )
            continue
        packing = "u16" if name == "Biomes16v2" else "byte"
        out = _rotate_packed(_as_bytes(raw), packing, turn, per_column=True)
        if out is not None:
            level[name] = ByteArray(np.frombuffer(out, dtype=np.int8).tolist())


def _section_ids_and_meta(
    section: nbtlib.Compound,
) -> tuple[npt.NDArray[np.int32], npt.NDArray[np.int32], str] | None:
    """(block ids, metadata, which packing) for one section, or None if unreadable."""
    b16 = section.get("Blocks16")
    if b16 is not None:
        raw = _as_bytes(b16)
        if len(raw) != 8192:
            return None
        ids = unpack_u16(raw).astype(np.int32)
        d16 = section.get("Data16")
        meta = (
            unpack_u16(_as_bytes(d16)).astype(np.int32)
            if d16 is not None and len(_as_bytes(d16)) == 8192
            else np.zeros(4096, dtype=np.int32)
        )
        return ids, meta, "u16"

    blocks = section.get("Blocks")
    if blocks is None:
        return None
    raw = _as_bytes(blocks)
    if len(raw) != 4096:
        return None
    ids = unpack_bytes(raw).astype(np.int32)
    add = section.get("Add")
    if add is not None and len(_as_bytes(add)) == 2048:
        ids |= unpack_nibbles(_as_bytes(add), 4096).astype(np.int32) << 8
    data = section.get("Data")
    meta = (
        unpack_nibbles(_as_bytes(data), 4096).astype(np.int32)
        if data is not None and len(_as_bytes(data)) == 2048
        else np.zeros(4096, dtype=np.int32)
    )
    return ids, meta, "nibble"


def _orient_blocks(level: nbtlib.Compound, turn: int, report: OrientReport) -> None:
    """Re-face every block whose metadata encodes a direction.

    Applied per distinct block id with a lookup table, so the cost is a handful
    of vectorised passes rather than one Python call per block.
    """
    for section in level.get("Sections") or []:
        read = _section_ids_and_meta(section)
        if read is None:
            continue
        ids, meta, packing = read
        out = meta.copy()

        for block_id in np.unique(ids):
            bid = int(block_id)
            mask = ids == bid
            lut = meta_lut(bid, turn)
            if lut is None:
                # Only vanilla ids are worth reporting; see rotate_block_meta.
                if 0 < bid < 256 and bool((meta[mask] != 0).any()):
                    n = int((meta[mask] != 0).sum())
                    report.blocks_skipped[bid] = report.blocks_skipped.get(bid, 0) + n
                continue
            table = np.array(lut, dtype=np.int32)
            low = meta[mask] & 0xF
            out[mask] = (meta[mask] & ~0xF) | table[low]

        changed = int((out != meta).sum())
        if not changed:
            continue
        report.blocks_turned += changed
        if packing == "u16":
            section["Data16"] = ByteArray(
                np.frombuffer(pack_u16(out.astype(np.uint16)), dtype=np.int8).tolist()
            )
        else:
            section["Data"] = ByteArray(
                np.frombuffer(pack_nibbles(out.astype(np.uint16)), dtype=np.int8).tolist()
            )


def _turn_local(lx: float, lz: float, turn: int, span: float) -> tuple[float, float]:
    """Turn a position within one chunk's square about that square's centre.

    *span* is 16 for continuous coordinates and 15 for whole-block indices — the
    difference between rotating a square and rotating the cells inside it.
    """
    if turn == 90:
        return span - lz, lx
    if turn == 180:
        return span - lx, span - lz
    if turn == 270:
        return lz, span - lx
    return lx, lz


def _level(f: nbtlib.File) -> nbtlib.Compound:
    # MC chunk root is an unnamed compound holding "Level".
    if "Level" in f:
        return f["Level"]
    return f[""]["Level"]


def remap_chunk_record(
    record: bytes,
    new_cx: int,
    new_cz: int,
    dx_blocks: int,
    dz_blocks: int,
    turn: int = 0,
    old_cx: int | None = None,
    old_cz: int | None = None,
    report: OrientReport | None = None,
) -> bytes:
    """Return a new region record for the chunk moved to (new_cx, new_cz).

    *record* is the raw ``[len][compression][payload]``. Without a *turn* this is
    a pure shift and *dx_blocks*/*dz_blocks* are applied to every stored position.

    With a *turn*, stored positions are instead recomputed from the destination
    chunk and the block's rotated position within its own chunk. That is not an
    alternative way of writing the same sum: the offset is only well-defined for
    a shift, whereas a turn moves a block *within* its chunk as well as moving
    the chunk. Deriving from the destination is what keeps tile entities on top
    of the blocks they belong to. *old_cx*/*old_cz* default to the chunk's own
    recorded position.
    """
    length = struct.unpack_from(">I", record, 0)[0]
    comp = record[4]
    payload = record[5 : 4 + length]
    raw = gzip.decompress(payload) if comp == 1 else zlib.decompress(payload)

    f = nbtlib.File.parse(io.BytesIO(raw), byteorder="big")
    level = _level(f)
    src_cx = int(level.get("xPos", 0)) if old_cx is None else old_cx
    src_cz = int(level.get("zPos", 0)) if old_cz is None else old_cz
    level["xPos"] = Int(new_cx)
    level["zPos"] = Int(new_cz)

    rep = report if report is not None else OrientReport()
    if turn:
        _rotate_chunk_arrays(level, turn)
        _orient_blocks(level, turn, rep)

    def move_block(x: int, z: int) -> tuple[int, int]:
        if not turn:
            return x + dx_blocks, z + dz_blocks
        lx, lz = _turn_local(x - src_cx * 16, z - src_cz * 16, turn, 15)
        return new_cx * 16 + int(lx), new_cz * 16 + int(lz)

    for te in level.get("TileEntities") or []:
        te["x"], te["z"] = (Int(v) for v in move_block(int(te["x"]), int(te["z"])))
        if turn:
            rotate_tile_entity(te, turn, rep)

    for tt in level.get("TileTicks") or []:
        tt["x"], tt["z"] = (Int(v) for v in move_block(int(tt["x"]), int(tt["z"])))

    for ent in level.get("Entities") or []:
        pos = ent.get("Pos")
        if pos is not None and len(pos) == 3:
            if turn:
                lx, lz = _turn_local(
                    float(pos[0]) - src_cx * 16, float(pos[2]) - src_cz * 16, turn, 16.0
                )
                pos[0], pos[2] = Double(new_cx * 16 + lx), Double(new_cz * 16 + lz)
            else:
                pos[0] = Double(float(pos[0]) + dx_blocks)
                pos[2] = Double(float(pos[2]) + dz_blocks)
        # Yaw is measured from south and grows clockwise, the same sense as the
        # turn, so a quarter turn is a straight addition.
        rot = ent.get("Rotation")
        if turn and rot is not None and len(rot) >= 1:
            rot[0] = type(rot[0])((float(rot[0]) + turn) % 360.0)
        if "TileX" in ent:  # hanging entities (paintings, item frames)
            tx, tz = move_block(int(ent["TileX"]), int(ent["TileZ"]))
            ent["TileX"], ent["TileZ"] = Int(tx), Int(tz)
        if turn and "Direction" in ent:  # which wall it hangs on
            ent["Direction"] = type(ent["Direction"])((int(ent["Direction"]) + turn // 90) % 4)

    out = io.BytesIO()
    f.write(out, byteorder="big")
    return make_record(out.getvalue())
