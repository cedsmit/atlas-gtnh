"""Rotate a chunk's contents by a multiple of 90° about the vertical axis.

Rotating a *selection* of chunks is two independent jobs, and this module owns
the second one:

1. Move each chunk to its new coordinate in the rotated grid (the caller's job —
   see ``chunk_ops_service``).
2. Rotate everything *inside* the chunk, so the 16×16 footprint lands the same
   way round as the grid did. That is this module.

Both are needed: rotating only the grid would shuffle chunks while leaving every
building inside them facing the original way.

Coordinates are Minecraft's, seen from above with +X east and +Z south, so a
clockwise turn sends east to south::

    cw90:  (x, z) -> (-z, x)

Inside a chunk the same turn about the chunk's own centre is
``(lx, lz) -> (15 - lz, lx)``, which keeps every block in the same 16×16 column
— that is what makes the two jobs separable.

Block *orientation* (which way a furnace faces) is not handled here; that is
metadata and tile-entity state, and lives in ``chunk_orient``.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

_NDArr = npt.NDArray[np.uint16]

#: Section arrays are indexed YZX: ``index = y*256 + z*16 + x``.
_SECTION_SHAPE = (16, 16, 16)  # (y, z, x)

#: Legal rotations, in degrees clockwise seen from above.
TURNS = (0, 90, 180, 270)


def normalise_turn(degrees: int) -> int:
    """Fold *degrees* onto one of :data:`TURNS`. Raises on anything else."""
    turn = degrees % 360
    if turn not in TURNS:
        raise ValueError(f"rotation must be a multiple of 90°, got {degrees}")
    return turn


def rotate_grid(
    cx: int, cz: int, turn: int, cx0: int, cz0: int, width: int, height: int
) -> tuple[int, int]:
    """Where chunk (cx, cz) lands when the selection is turned *turn* degrees.

    The selection is the chunk box whose corner is (cx0, cz0) and whose size is
    *width* × *height* chunks. The result is expressed in the same corner-anchored
    frame, so a 90° turn returns coordinates inside a *height* × *width* box —
    the caller decides where that box sits in the world.
    """
    i, j = cx - cx0, cz - cz0  # offset within the selection
    if turn == 0:
        return i, j
    if turn == 90:
        return height - 1 - j, i
    if turn == 180:
        return width - 1 - i, height - 1 - j
    return j, width - 1 - i  # 270


def rotate_yzx(values: _NDArr, turn: int) -> _NDArr:
    """Rotate one 4096-entry section array (YZX order) about the vertical axis.

    Pure index permutation, so it is exact for whatever the entries mean —
    block ids, metadata, or light levels.
    """
    if turn == 0:
        return values
    a = values.reshape(_SECTION_SHAPE)  # (y, z, x)
    if turn == 90:
        # out[y][x][15-z] = in[y][z][x]
        out = a.transpose(0, 2, 1)[:, :, ::-1]
    elif turn == 180:
        out = a[:, ::-1, ::-1]
    else:  # 270
        out = a.transpose(0, 2, 1)[:, ::-1, :]
    return np.ascontiguousarray(out).reshape(-1)


def rotate_columns(values: _NDArr, turn: int) -> _NDArr:
    """Rotate a 256-entry per-column array (ZX order) — biomes and height maps."""
    if turn == 0:
        return values
    a = values.reshape(16, 16)  # (z, x)
    if turn == 90:
        out = a.transpose(1, 0)[:, ::-1]
    elif turn == 180:
        out = a[::-1, ::-1]
    else:
        out = a.transpose(1, 0)[::-1, :]
    return np.ascontiguousarray(out).reshape(-1)


# ── Packed-array plumbing ────────────────────────────────────────────────────
# Chunk arrays arrive in four packings. Each unpacks to one value per block,
# rotates identically, then repacks — so the rotation never has to know which
# storage format a particular world or mod chose.


def unpack_nibbles(raw: bytes, count: int) -> _NDArr:
    """2048 bytes -> *count* values. Low nibble is the even index."""
    b = np.frombuffer(raw, dtype=np.uint8)
    out = np.empty(count, dtype=np.uint16)
    out[0::2] = b & 0xF
    out[1::2] = (b >> 4) & 0xF
    return out


def pack_nibbles(values: _NDArr) -> bytes:
    """Inverse of :func:`unpack_nibbles`."""
    lo = (values[0::2] & 0xF).astype(np.uint8)
    hi = (values[1::2] & 0xF).astype(np.uint8)
    return bytes((lo | (hi << 4)).astype(np.uint8))


def unpack_u16(raw: bytes) -> _NDArr:
    """Big-endian uint16 pairs — GTNH's Blocks16/Data16."""
    return np.frombuffer(raw, dtype=">u2").astype(np.uint16)


def pack_u16(values: _NDArr) -> bytes:
    return bytes(values.astype(">u2").tobytes())


def unpack_bytes(raw: bytes) -> _NDArr:
    return np.frombuffer(raw, dtype=np.uint8).astype(np.uint16)


def pack_bytes(values: _NDArr) -> bytes:
    return bytes(values.astype(np.uint8).tobytes())
