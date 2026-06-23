import io
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

import nbtlib

SECTOR_SIZE = 4096


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
    data = path.read_bytes()
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
