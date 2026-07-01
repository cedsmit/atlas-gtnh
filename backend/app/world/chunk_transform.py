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
from nbtlib import Double, Int

from app.world.region_writer import make_record


def _level(f: nbtlib.File) -> nbtlib.Compound:
    # MC chunk root is an unnamed compound holding "Level".
    if "Level" in f:
        return f["Level"]
    return f[""]["Level"]


def remap_chunk_record(
    record: bytes, new_cx: int, new_cz: int, dx_blocks: int, dz_blocks: int
) -> bytes:
    """Return a new region record for the chunk moved to (new_cx, new_cz).

    *record* is the raw ``[len][compression][payload]``; *dx_blocks*/*dz_blocks*
    are the block-space offset applied to all stored positions.
    """
    length = struct.unpack_from(">I", record, 0)[0]
    comp = record[4]
    payload = record[5 : 4 + length]
    raw = gzip.decompress(payload) if comp == 1 else zlib.decompress(payload)

    f = nbtlib.File.parse(io.BytesIO(raw), byteorder="big")
    level = _level(f)
    level["xPos"] = Int(new_cx)
    level["zPos"] = Int(new_cz)

    for te in level.get("TileEntities") or []:
        te["x"] = Int(int(te["x"]) + dx_blocks)
        te["z"] = Int(int(te["z"]) + dz_blocks)

    for ent in level.get("Entities") or []:
        pos = ent.get("Pos")
        if pos is not None and len(pos) == 3:
            pos[0] = Double(float(pos[0]) + dx_blocks)
            pos[2] = Double(float(pos[2]) + dz_blocks)
        if "TileX" in ent:  # hanging entities (paintings, item frames)
            ent["TileX"] = Int(int(ent["TileX"]) + dx_blocks)
        if "TileZ" in ent:
            ent["TileZ"] = Int(int(ent["TileZ"]) + dz_blocks)

    for tt in level.get("TileTicks") or []:
        tt["x"] = Int(int(tt["x"]) + dx_blocks)
        tt["z"] = Int(int(tt["z"]) + dz_blocks)

    out = io.BytesIO()
    f.write(out, byteorder="big")
    return make_record(out.getvalue())
