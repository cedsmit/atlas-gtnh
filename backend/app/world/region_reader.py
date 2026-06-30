import io
import logging
import struct
import zlib
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import nbtlib
import numpy as np

log = logging.getLogger(__name__)

SECTOR_SIZE = 4096
# Reject absurdly large .mca files (corrupt / not really a region) before reading
# the whole thing into memory.  Real region files are a few MB to tens of MB.
_MAX_REGION_BYTES = 256 * 1024 * 1024

_NDArr = np.ndarray[Any, Any]

# ── Region byte cache ────────────────────────────────────────────────────────
# Reading a single chunk requires the whole .mca file, and a region holds up to
# 1024 chunks.  Without caching, rendering one region re-reads the same multi-MB
# file up to 1024 times.  Cache the raw bytes keyed by (path, mtime, size) so a
# region is read from disk once and reused across all its chunks; the signature
# invalidates the entry when the file changes on disk.
_REGION_BYTES_CACHE: "OrderedDict[str, tuple[float, int, bytes]]" = OrderedDict()
_REGION_BYTES_CACHE_LOCK = Lock()
_REGION_BYTES_CACHE_MAX = 24  # most-recently-used region files kept resident


def _read_region_bytes(path: Path) -> bytes:
    """Return the contents of an .mca file, cached by (path, mtime, size)."""
    stat = path.stat()
    if stat.st_size > _MAX_REGION_BYTES:
        raise ValueError(f"Region file too large to read ({stat.st_size} bytes): {path.name}")
    key = str(path)
    with _REGION_BYTES_CACHE_LOCK:
        cached = _REGION_BYTES_CACHE.get(key)
        if cached is not None and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
            _REGION_BYTES_CACHE.move_to_end(key)
            return cached[2]

    data = path.read_bytes()

    with _REGION_BYTES_CACHE_LOCK:
        _REGION_BYTES_CACHE[key] = (stat.st_mtime, stat.st_size, data)
        _REGION_BYTES_CACHE.move_to_end(key)
        while len(_REGION_BYTES_CACHE) > _REGION_BYTES_CACHE_MAX:
            _REGION_BYTES_CACHE.popitem(last=False)
    return data


@dataclass
class RawChunk:
    local_x: int
    local_z: int
    timestamp: int
    chunk_x: int
    chunk_z: int
    last_update: int
    inhabited_time: int
    populated: bool


@dataclass
class ChunkSection:
    y: int
    blocks: list[int]  # 4096 unsigned block IDs (0-4095)
    data: list[int]  # 4096 metadata nibbles (0-15)


@dataclass
class RawChunkData:
    chunk_x: int
    chunk_z: int
    sections: list[ChunkSection]
    biomes: list[int]  # 256 biome IDs, indexed x + z*16; empty = not stored


@dataclass
class RawChunkSurface:
    """Compact top-down summary of a chunk for low-detail (region tile) rendering.

    All per-column lists are 256 long, indexed x + z*16 to match biomes.
    """

    chunk_x: int
    chunk_z: int
    ids: list[int]  # topmost non-air block id per column (0 = empty column)
    metas: list[int]  # metadata of that block
    heights: list[int]  # absolute Y of that block (-1 = empty column)
    biomes: list[int]  # 256 biome IDs, or empty when not stored


def _parse_location_table(data: bytes) -> list[tuple[int, int, int, int]]:
    """Return list of (local_x, local_z, offset_sectors, timestamp) for present chunks."""
    entries = []
    for i in range(1024):
        loc = i * 4
        raw = struct.unpack(">I", data[loc : loc + 4])[0]
        offset = raw >> 8
        sectors = raw & 0xFF
        if offset == 0 or sectors == 0:
            continue
        timestamp = struct.unpack(">I", data[SECTOR_SIZE + loc : SECTOR_SIZE + loc + 4])[0]
        entries.append((i % 32, i // 32, offset, timestamp))
    return entries


def _decompress_chunk(data: bytes, offset_sectors: int) -> bytes:
    byte_offset = offset_sectors * SECTOR_SIZE
    length = struct.unpack(">I", data[byte_offset : byte_offset + 4])[0]
    compression = data[byte_offset + 4]
    payload = data[byte_offset + 5 : byte_offset + 4 + length]

    if compression == 2:
        return zlib.decompress(payload)
    if compression == 1:
        import gzip

        return gzip.decompress(payload)
    return payload  # type 3 = uncompressed


def _parse_chunk_nbt(raw: bytes, local_x: int, local_z: int, timestamp: int) -> RawChunk:
    nbt_file = nbtlib.File.parse(io.BytesIO(raw))
    level = nbt_file["Level"]
    return RawChunk(
        local_x=local_x,
        local_z=local_z,
        timestamp=timestamp,
        chunk_x=int(level["xPos"]),
        chunk_z=int(level["zPos"]),
        last_update=int(level.get("LastUpdate", nbtlib.Long(0))),
        inhabited_time=int(level.get("InhabitedTime", nbtlib.Long(0))),
        populated=bool(int(level.get("TerrainPopulated", nbtlib.Byte(0)))),
    )


def read_region(path: Path) -> tuple[list[RawChunk], int]:
    """Parse an .mca region file. Returns (chunks, skipped_count)."""
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    chunks: list[RawChunk] = []
    skipped = 0

    for local_x, local_z, offset, timestamp in _parse_location_table(data):
        try:
            raw = _decompress_chunk(data, offset)
            chunks.append(_parse_chunk_nbt(raw, local_x, local_z, timestamp))
        except Exception:
            skipped += 1

    return chunks, skipped


# ── Fast targeted NBT reader ─────────────────────────────────────────────────
# nbtlib.File.parse builds the entire NBT tree per chunk — including the large
# GTNH tile-entity/entity data — which dominates parse time (~2.6 ms/chunk, all
# pure-Python).  Chunk rendering only needs Sections, Biomes and the chunk
# position, so this walker extracts exactly those and seeks past everything else,
# roughly 3-4× faster.  Validated to produce identical output on real worlds.
_TAG_END, _TAG_BYTE, _TAG_SHORT, _TAG_INT, _TAG_LONG, _TAG_FLOAT, _TAG_DOUBLE = range(7)
_TAG_BYTE_ARRAY, _TAG_STRING, _TAG_LIST, _TAG_COMPOUND = range(7, 11)
_TAG_INT_ARRAY, _TAG_LONG_ARRAY = 11, 12

_SECTION_KEYS = frozenset((b"Blocks16", b"Data16", b"Blocks", b"Add", b"Data"))


def _nbt_skip(buf: memoryview, pos: int, tag: int) -> int:
    """Return the position just past the payload of *tag* starting at *pos*."""
    if tag == _TAG_BYTE:
        return pos + 1
    if tag == _TAG_SHORT:
        return pos + 2
    if tag in (_TAG_INT, _TAG_FLOAT):
        return pos + 4
    if tag in (_TAG_LONG, _TAG_DOUBLE):
        return pos + 8
    if tag == _TAG_BYTE_ARRAY:
        return pos + 4 + int(struct.unpack_from(">i", buf, pos)[0])
    if tag == _TAG_STRING:
        return pos + 2 + int(struct.unpack_from(">H", buf, pos)[0])
    if tag == _TAG_INT_ARRAY:
        return pos + 4 + int(struct.unpack_from(">i", buf, pos)[0]) * 4
    if tag == _TAG_LONG_ARRAY:
        return pos + 4 + int(struct.unpack_from(">i", buf, pos)[0]) * 8
    if tag == _TAG_LIST:
        elem = buf[pos]
        count = struct.unpack_from(">i", buf, pos + 1)[0]
        pos += 5
        for _ in range(count):
            pos = _nbt_skip(buf, pos, elem)
        return pos
    if tag == _TAG_COMPOUND:
        while True:
            t = buf[pos]
            pos += 1
            if t == _TAG_END:
                return pos
            pos += 2 + struct.unpack_from(">H", buf, pos)[0]  # name
            pos = _nbt_skip(buf, pos, t)
    raise ValueError(f"Unknown NBT tag: {tag}")


def _nbt_name(buf: memoryview, pos: int) -> tuple[bytes, int]:
    nl = struct.unpack_from(">H", buf, pos)[0]
    return bytes(buf[pos + 2 : pos + 2 + nl]), pos + 2 + nl


def _fast_parse_chunk(raw_nbt: bytes) -> tuple[int, int, bytes, list[dict[str, Any]]]:
    """Extract (chunk_x, chunk_z, biomes_bytes, sections) from decompressed NBT.

    Each section dict holds its 'Y' and the raw byte arrays present
    (Blocks16/Data16 or Blocks/Add/Data); unrelated keys are skipped.
    """
    buf = memoryview(raw_nbt)
    pos = 1  # skip root tag id
    pos += 2 + struct.unpack_from(">H", buf, pos)[0]  # root name

    # Find the "Level" compound.
    level_pos = -1
    while True:
        t = buf[pos]
        pos += 1
        if t == _TAG_END:
            break
        name, pos = _nbt_name(buf, pos)
        if t == _TAG_COMPOUND and name == b"Level":
            level_pos = pos
            break
        pos = _nbt_skip(buf, pos, t)
    if level_pos < 0:
        raise ValueError("Chunk NBT has no Level compound")

    pos = level_pos
    xpos = zpos = 0
    biomes = b""
    sections: list[dict[str, Any]] = []
    while True:
        t = buf[pos]
        pos += 1
        if t == _TAG_END:
            break
        name, pos = _nbt_name(buf, pos)
        if t == _TAG_INT and name == b"xPos":
            xpos = struct.unpack_from(">i", buf, pos)[0]
            pos += 4
        elif t == _TAG_INT and name == b"zPos":
            zpos = struct.unpack_from(">i", buf, pos)[0]
            pos += 4
        elif t == _TAG_BYTE_ARRAY and name == b"Biomes":
            n = struct.unpack_from(">i", buf, pos)[0]
            pos += 4
            biomes = bytes(buf[pos : pos + n])
            pos += n
        elif t == _TAG_LIST and name == b"Sections":
            count = struct.unpack_from(">i", buf, pos + 1)[0]
            pos += 5
            for _ in range(count):
                sec: dict[str, Any] = {}
                while True:
                    st = buf[pos]
                    pos += 1
                    if st == _TAG_END:
                        break
                    sname, pos = _nbt_name(buf, pos)
                    if st == _TAG_BYTE and sname == b"Y":
                        sec["Y"] = struct.unpack_from(">b", buf, pos)[0]
                        pos += 1
                    elif st == _TAG_BYTE_ARRAY and sname in _SECTION_KEYS:
                        n = struct.unpack_from(">i", buf, pos)[0]
                        pos += 4
                        sec[sname.decode()] = bytes(buf[pos : pos + n])
                        pos += n
                    else:
                        pos = _nbt_skip(buf, pos, st)
                sections.append(sec)
        else:
            pos = _nbt_skip(buf, pos, t)

    return int(xpos), int(zpos), biomes, sections


def _section_arrays(sec: dict[str, Any]) -> tuple[_NDArr, _NDArr] | None:
    """(blocks, data) as uint16 arrays of length 4096 from a raw-byte section."""
    b16 = sec.get("Blocks16")
    if b16 is not None and len(b16) == 8192:
        blocks = np.frombuffer(b16, dtype=">u2").astype(np.uint16)
        d16 = sec.get("Data16")
        if d16 is not None and len(d16) == 8192:
            data = np.frombuffer(d16, dtype=">u2").astype(np.uint16)
        else:
            data = np.zeros(4096, dtype=np.uint16)
        return blocks, data

    b = sec.get("Blocks")
    if b is None or len(b) != 4096:
        return None
    blocks = np.frombuffer(b, dtype=np.uint8).astype(np.uint16)
    add = sec.get("Add")
    if add is not None and len(add) == 2048:
        a = np.frombuffer(add, dtype=np.uint8)
        nib = np.empty(4096, dtype=np.uint16)
        nib[0::2] = a & 0xF
        nib[1::2] = (a >> 4) & 0xF
        blocks = (blocks | (nib << 8)).astype(np.uint16)
    d = sec.get("Data")
    if d is not None and len(d) == 2048:
        dd = np.frombuffer(d, dtype=np.uint8)
        data = np.empty(4096, dtype=np.uint16)
        data[0::2] = dd & 0xF
        data[1::2] = (dd >> 4) & 0xF
    else:
        data = np.zeros(4096, dtype=np.uint16)
    return blocks, data


def _decode_biomes(biomes_bytes: bytes, chunk_x: int, chunk_z: int) -> list[int]:
    """256 biome ids, or [] when absent. Logs (and drops) a corrupt non-256 array."""
    if len(biomes_bytes) == 256:
        return list(biomes_bytes)
    if biomes_bytes:
        log.warning(
            "chunk (%d,%d): dropping biome array of length %d (expected 256)",
            chunk_x,
            chunk_z,
            len(biomes_bytes),
        )
    return []


def _parse_chunk_full(raw_nbt: bytes) -> RawChunkData:
    """Parse decompressed chunk NBT into full block data (sections + biomes)."""
    xpos, zpos, biomes_bytes, raw_sections = _fast_parse_chunk(raw_nbt)
    biomes = _decode_biomes(biomes_bytes, xpos, zpos)

    sections: list[ChunkSection] = []
    for sec in raw_sections:
        arrays = _section_arrays(sec)
        if arrays is None:
            continue
        blocks, data = arrays
        sections.append(ChunkSection(y=sec.get("Y", 0), blocks=blocks.tolist(), data=data.tolist()))

    return RawChunkData(
        chunk_x=xpos,
        chunk_z=zpos,
        sections=sorted(sections, key=lambda s: s.y),
        biomes=biomes,
    )


def read_chunk_data(path: Path, local_x: int, local_z: int) -> RawChunkData:
    """Read full block data for a single chunk in a region file."""
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    idx = local_z * 32 + local_x
    loc = idx * 4
    raw = struct.unpack(">I", data[loc : loc + 4])[0]
    offset = raw >> 8

    if offset == 0:
        raise FileNotFoundError(f"Chunk ({local_x}, {local_z}) not present in region")

    return _parse_chunk_full(_decompress_chunk(data, offset))


def read_region_chunks(
    path: Path, wanted: set[tuple[int, int]] | None = None
) -> dict[tuple[int, int], RawChunkData]:
    """Read full block data for many chunks in a region with a single file read.

    Parses every present chunk, or only those in *wanted* (a set of (local_x,
    local_z) pairs) when given.  Chunks that are absent, corrupt, or have no
    terrain are silently omitted.  Returned dict is keyed by (local_x, local_z).
    """
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    result: dict[tuple[int, int], RawChunkData] = {}
    for local_x, local_z, offset, _timestamp in _parse_location_table(data):
        if wanted is not None and (local_x, local_z) not in wanted:
            continue
        try:
            chunk = _parse_chunk_full(_decompress_chunk(data, offset))
        except Exception:
            continue
        if chunk.sections:
            result[(local_x, local_z)] = chunk
    return result


# Block ids treated as air for surface purposes, so the overview shows the
# terrain beneath them.  Mirrors the frontend's default-hidden transient blocks
# (currently fire, id 51); the place to make this configurable later.
_SURFACE_SKIP_IDS: tuple[int, ...] = (51,)


def _parse_chunk_surface(raw_nbt: bytes) -> RawChunkSurface:
    """Extract the topmost non-air, non-hidden block per column from chunk NBT."""
    xpos, zpos, biomes_bytes, raw_sections = _fast_parse_chunk(raw_nbt)
    biomes = _decode_biomes(biomes_bytes, xpos, zpos)

    ids = np.zeros(256, dtype=np.uint16)
    metas = np.zeros(256, dtype=np.uint8)
    heights = np.full(256, -1, dtype=np.int16)
    filled = np.zeros(256, dtype=bool)

    # Highest sections first so the first non-air block found per column is the surface.
    for sec in sorted(raw_sections, key=lambda s: s.get("Y", 0), reverse=True):
        if filled.all():
            break
        arrays = _section_arrays(sec)
        if arrays is None:
            continue
        blocks, data = arrays
        b2 = blocks.reshape(16, 256)  # [y, col]
        d2 = data.reshape(16, 256)
        mask = b2 != 0
        for sid in _SURFACE_SKIP_IDS:
            mask &= b2 != sid
        col_has = mask.any(axis=0)  # [col]
        to_fill = col_has & ~filled
        if not to_fill.any():
            continue
        # Topmost y per column (valid only where col_has).
        top_y = 15 - mask[::-1].argmax(axis=0)  # [col]
        cols = np.nonzero(to_fill)[0]
        ty = top_y[cols]
        ids[cols] = b2[ty, cols]
        metas[cols] = d2[ty, cols].astype(np.uint8)
        heights[cols] = sec.get("Y", 0) * 16 + ty
        filled[cols] = True

    return RawChunkSurface(
        chunk_x=xpos,
        chunk_z=zpos,
        ids=ids.tolist(),
        metas=metas.tolist(),
        heights=heights.tolist(),
        biomes=biomes,
    )


def read_region_surface(path: Path) -> list[RawChunkSurface]:
    """Read a compact surface summary for every present chunk in a region.

    Reads the file once (cached).  Corrupt or empty chunks are skipped.
    """
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    out: list[RawChunkSurface] = []
    for _local_x, _local_z, offset, _timestamp in _parse_location_table(data):
        try:
            surface = _parse_chunk_surface(_decompress_chunk(data, offset))
        except Exception:
            continue
        out.append(surface)
    return out
