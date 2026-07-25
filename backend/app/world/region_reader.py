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
    # Kept as the uint16 arrays the decode produced, length 4096 each. They used
    # to be materialised into Python lists here, which cost 8192 boxed ints per
    # section before anything had asked for one — the batch path now ships the
    # array's bytes straight out (see world/section_codec.py), and the JSON
    # single-chunk endpoint converts where it needs to.
    blocks: _NDArr  # 4096 unsigned block IDs (0-4095)
    data: _NDArr  # 4096 metadata values (nibbles, or 16-bit on Data16 worlds)


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
    # For water-surface columns: the seabed block below the water and the water
    # depth, so the overview can render translucent water over the floor. 0 for
    # non-water columns (floor_ids) / where no floor was found (water_depth).
    floor_ids: list[int]  # seabed block id under water (0 = none)
    water_depth: list[int]  # surface−floor block count, capped (0 = none)


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
    biomes = b""  # vanilla 256-byte biome array
    biomes16 = b""  # modded 512-byte 16-bit biome array (Biomes16v2), if present
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
        elif t == _TAG_BYTE_ARRAY and name == b"Biomes16v2":
            # GTNH/modded 16-bit biome storage (ids > 255). Decoded by length in
            # _decode_biomes; preferred over vanilla Biomes when both are present.
            n = struct.unpack_from(">i", buf, pos)[0]
            pos += 4
            biomes16 = bytes(buf[pos : pos + n])
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

    return int(xpos), int(zpos), biomes16 or biomes, sections


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
    """256 biome ids, or [] when absent/corrupt.

    Handles both storage formats, distinguished by length:
    - 256 bytes: vanilla ``Biomes`` (one byte per column, ids 0-255).
    - 512 bytes: modded ``Biomes16v2`` — 256 little-endian 16-bit ids (GTNH uses
      this for biome ids above 255).
    """
    if len(biomes_bytes) == 256:
        return list(biomes_bytes)
    if len(biomes_bytes) == 512:
        ids16: list[int] = np.frombuffer(biomes_bytes, dtype="<u2").tolist()
        return ids16
    if biomes_bytes:
        log.warning(
            "chunk (%d,%d): dropping biome array of length %d (expected 256 or 512)",
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
        sections.append(ChunkSection(y=sec.get("Y", 0), blocks=blocks, data=data))

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


# Block ids always treated as air for surface purposes, so the overview shows the
# terrain beneath them.  Fire (51) is a transient the map hides everywhere; the
# caller passes additional ids per request (the frontend's plant classification,
# covering modded plants) via read_region_surface's skip_ids.
_SURFACE_SKIP_IDS: tuple[int, ...] = (51,)
_DEFAULT_SKIP_ARR = np.array(_SURFACE_SKIP_IDS, dtype=np.uint16)
_WATER_IDS = (8, 9)  # flowing + still water
_WATER_ARR = np.array(_WATER_IDS, dtype=np.uint16)
_MAX_WATER_DEPTH = 63  # depth cap (fits uint8 and the render curve)


def _scan_topmost(
    raw_sections: list[dict[str, Any]], skip_arr: _NDArr, only_cols: _NDArr | None = None
) -> tuple[_NDArr, _NDArr, _NDArr]:
    """Topmost non-air, non-skip block per column → (ids, metas, heights[-1]).

    *only_cols* (bool[256]) limits the scan to those columns; the rest stay empty.
    """
    ids = np.zeros(256, dtype=np.uint16)
    metas = np.zeros(256, dtype=np.uint8)
    heights = np.full(256, -1, dtype=np.int16)
    filled = np.zeros(256, dtype=bool) if only_cols is None else ~only_cols

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
        if skip_arr.size:
            mask &= ~np.isin(b2, skip_arr)
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

    return ids, metas, heights


def _parse_chunk_surface(raw_nbt: bytes, skip_arr: _NDArr | None = None) -> RawChunkSurface:
    """Extract the topmost non-air, non-skipped block per column from chunk NBT."""
    if skip_arr is None:
        skip_arr = _DEFAULT_SKIP_ARR
    xpos, zpos, biomes_bytes, raw_sections = _fast_parse_chunk(raw_nbt)
    biomes = _decode_biomes(biomes_bytes, xpos, zpos)

    ids, metas, heights = _scan_topmost(raw_sections, skip_arr)

    # For water-surface columns, find the seabed (topmost non-water block below)
    # and the water depth, so the overview can render translucent water.
    floor_ids = np.zeros(256, dtype=np.uint16)
    water_depth = np.zeros(256, dtype=np.uint8)
    water_cols = np.isin(ids, _WATER_ARR)
    if water_cols.any():
        floor_skip = np.concatenate([np.asarray(skip_arr, dtype=np.uint16), _WATER_ARR])
        f_ids, _f_metas, f_heights = _scan_topmost(raw_sections, floor_skip, only_cols=water_cols)
        has_floor = water_cols & (f_heights >= 0)
        floor_ids[has_floor] = f_ids[has_floor]
        depth = np.clip(heights - f_heights, 1, _MAX_WATER_DEPTH).astype(np.uint8)
        water_depth[has_floor] = depth[has_floor]

    return RawChunkSurface(
        chunk_x=xpos,
        chunk_z=zpos,
        ids=ids.tolist(),
        metas=metas.tolist(),
        heights=heights.tolist(),
        biomes=biomes,
        floor_ids=floor_ids.tolist(),
        water_depth=water_depth.tolist(),
    )


def read_region_surface(
    path: Path, skip_ids: frozenset[int] = frozenset()
) -> list[RawChunkSurface]:
    """Read a compact surface summary for every present chunk in a region.

    Reads the file once (cached).  Corrupt or empty chunks are skipped.
    *skip_ids* are block ids treated as air for surface purposes (unioned with
    the always-skipped set) so the overview reports the terrain beneath them.
    """
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    skip_arr = (
        np.fromiter(set(_SURFACE_SKIP_IDS) | skip_ids, dtype=np.uint16)
        if skip_ids
        else _DEFAULT_SKIP_ARR
    )
    out: list[RawChunkSurface] = []
    for _local_x, _local_z, offset, _timestamp in _parse_location_table(data):
        try:
            surface = _parse_chunk_surface(_decompress_chunk(data, offset), skip_arr)
        except Exception:
            continue
        out.append(surface)
    return out


def scan_region_all_blocks(
    path: Path,
) -> list[tuple[int, int, int, int, int, int, int]]:
    """Index rows for every non-air block in a region — one per (chunk, block id).

    Returns (chunk_x, chunk_z, block_id, count, sx, sy, sz): the per-chunk count of
    each block id plus the world coords of its first occurrence. One numpy pass per
    section (unique + first-index + counts). Feeds the persistent search index.
    """
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        return []
    out: list[tuple[int, int, int, int, int, int, int]] = []
    for _local_x, _local_z, offset, _timestamp in _parse_location_table(data):
        try:
            xpos, zpos, _biomes, raw_sections = _fast_parse_chunk(_decompress_chunk(data, offset))
        except Exception:
            continue
        counts: dict[int, int] = {}
        sample: dict[int, tuple[int, int, int]] = {}
        for sec in raw_sections:
            arrays = _section_arrays(sec)
            if arrays is None:
                continue
            blocks, _meta = arrays
            secy = int(sec.get("Y", 0))
            uniq, first_idx, cnts = np.unique(blocks, return_index=True, return_counts=True)
            for bid, fidx, cnt in zip(
                uniq.tolist(), first_idx.tolist(), cnts.tolist(), strict=True
            ):
                if bid == 0:
                    continue
                counts[bid] = counts.get(bid, 0) + int(cnt)
                if bid not in sample:
                    sample[bid] = (
                        xpos * 16 + (fidx & 0xF),
                        secy * 16 + (fidx >> 8),
                        zpos * 16 + ((fidx >> 4) & 0xF),
                    )
        for bid, cnt in counts.items():
            sx, sy, sz = sample[bid]
            out.append((xpos, zpos, bid, cnt, sx, sy, sz))
    return out


def scan_region_all_biomes(
    path: Path,
) -> list[tuple[int, int, int, int, int, int]]:
    """Index rows for the biomes in a region — one per (chunk, biome id).

    Returns (chunk_x, chunk_z, biome_id, count, sx, sz): the per-chunk count of
    columns carrying each biome id plus the world coords of the first such column.
    Biomes are 2D (one id per XZ column, indexed x + z*16), so there is no Y. Only
    the cheap ``Biomes`` array is read (sections are skipped). Feeds the biome
    search index. Biome id 255 (the "uncalculated" marker) is skipped.
    """
    data = _read_region_bytes(path)
    if len(data) < 2 * SECTOR_SIZE:
        return []
    out: list[tuple[int, int, int, int, int, int]] = []
    for _local_x, _local_z, offset, _timestamp in _parse_location_table(data):
        try:
            xpos, zpos, biomes_bytes, _sections = _fast_parse_chunk(_decompress_chunk(data, offset))
        except Exception:
            continue
        biomes = _decode_biomes(biomes_bytes, xpos, zpos)
        if not biomes:
            continue
        counts: dict[int, int] = {}
        sample: dict[int, tuple[int, int]] = {}
        for idx, bid in enumerate(biomes):
            # 'uncalculated' markers: 255 (vanilla -1 byte), 65535 (16-bit -1).
            if bid == 255 or bid == 65535:
                continue
            counts[bid] = counts.get(bid, 0) + 1
            if bid not in sample:
                sample[bid] = (xpos * 16 + (idx & 0xF), zpos * 16 + (idx >> 4))
        for bid, cnt in counts.items():
            sx, sz = sample[bid]
            out.append((xpos, zpos, bid, cnt, sx, sz))
    return out
