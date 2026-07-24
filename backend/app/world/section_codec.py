"""Binary wire format for bulk chunk section data.

A batch of chunks is mostly two arrays per section — 4096 block ids and 4096
metadata values — and JSON is the wrong container for them twice over. Encoding
turns every one of those numbers into text (a 48-chunk batch runs to ~25 MB and
several hundred milliseconds of ``json.dumps`` on the server), and the browser
then spends the same order of magnitude in ``JSON.parse`` on the main thread,
blocking the frame loop it is trying to feed. The arrays are already contiguous
uint16 in the reader: this ships those bytes as they are.

Gzip is not the alternative. The transport is loopback, so this was never
bandwidth-bound — compressing would add CPU to both ends of the very stall it is
meant to relieve.

Layout, little-endian throughout::

    magic    4 bytes   b"ATL1"
    hdr_len  uint32    byte length of the header, padding included
    header   JSON, utf-8, space-padded so the payload starts 4-byte aligned
    payload  per chunk, in header order:
                 biomes  256 x uint16   (only when "biomes" is true)
                 then per section, in header "ys" order:
                     blocks  4096 x uint16
                     data    4096 x uint16

The header carries only what is not an array: ``{"chunks": [{"x", "z",
"biomes", "ys"}]}``. Every array in the payload is uint16, so a reader can take
typed-array views straight over the buffer — which needs the even offsets the
alignment rule guarantees.
"""

from __future__ import annotations

import json
import struct
from typing import Any

import numpy as np

from app.world.region_reader import RawChunkData

MAGIC = b"ATL1"
SECTION_VALUES = 4096
BIOME_VALUES = 256


def encode_chunk_batch(chunks: list[RawChunkData]) -> bytes:
    """Pack chunks into one buffer. Runs on the worker thread, never the loop."""
    header: dict[str, Any] = {
        "chunks": [
            {
                "x": c.chunk_x,
                "z": c.chunk_z,
                "biomes": len(c.biomes) == BIOME_VALUES,
                "ys": [s.y for s in c.sections],
            }
            for c in chunks
        ]
    }
    head = json.dumps(header, separators=(",", ":")).encode("utf-8")
    # Pad the header so the first array lands on a 4-byte boundary: a browser
    # cannot take a Uint16Array view at an odd offset.
    pad = -(len(MAGIC) + 4 + len(head)) % 4
    head += b" " * pad

    parts: list[bytes] = [MAGIC, struct.pack("<I", len(head)), head]
    for c in chunks:
        if len(c.biomes) == BIOME_VALUES:
            parts.append(np.asarray(c.biomes, dtype="<u2").tobytes())
        for s in c.sections:
            parts.append(_as_u16_le(s.blocks))
            parts.append(_as_u16_le(s.data))
    return b"".join(parts)


def _as_u16_le(arr: np.ndarray[Any, Any]) -> bytes:
    """Section array as little-endian uint16 bytes, copying only if it must.

    The reader already produces native uint16, so on a little-endian host this
    is the array's own buffer and the conversion is free. Anywhere else it is
    one byteswap — correctness first, and nobody is running this on a big-endian
    machine anyway.
    """
    return np.ascontiguousarray(arr, dtype="<u2").tobytes()


def decode_chunk_batch(buf: bytes) -> list[dict[str, Any]]:
    """Unpack what :func:`encode_chunk_batch` wrote.

    The frontend has its own decoder; this one exists so tests can assert on
    what actually went over the wire, and so the format has a reference reader
    in the language that writes it.
    """
    if buf[:4] != MAGIC:
        raise ValueError(f"not a chunk batch buffer: {buf[:4]!r}")
    (hdr_len,) = struct.unpack_from("<I", buf, 4)
    head = json.loads(buf[8 : 8 + hdr_len].decode("utf-8"))

    pos = 8 + hdr_len
    out: list[dict[str, Any]] = []
    for meta in head["chunks"]:
        chunk: dict[str, Any] = {
            "chunk_x": meta["x"],
            "chunk_z": meta["z"],
            "biomes": [],
            "sections": [],
        }
        if meta["biomes"]:
            end = pos + BIOME_VALUES * 2
            chunk["biomes"] = np.frombuffer(buf[pos:end], dtype="<u2").tolist()
            pos = end
        for y in meta["ys"]:
            blocks, pos = _read_u16(buf, pos, SECTION_VALUES)
            data, pos = _read_u16(buf, pos, SECTION_VALUES)
            chunk["sections"].append({"y": y, "blocks": blocks, "data": data})
        out.append(chunk)
    if pos != len(buf):
        raise ValueError(f"trailing bytes: read {pos} of {len(buf)}")
    return out


def _read_u16(buf: bytes, pos: int, count: int) -> tuple[list[int], int]:
    end = pos + count * 2
    values: list[int] = np.frombuffer(buf[pos:end], dtype="<u2").tolist()
    return values, end
