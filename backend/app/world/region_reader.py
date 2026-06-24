import io
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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


def _parse_nibbles(raw: bytes) -> list[int]:
    result: list[int] = []
    for byte in raw:
        result.append(byte & 0xF)
        result.append((byte >> 4) & 0xF)
    return result


def _parse_sections(level: Any) -> list[ChunkSection]:
    sections_tag = level.get("Sections")
    if not sections_tag:
        return []

    sections = []
    for section in sections_tag:
        y = int(section.get("Y", nbtlib.Byte(0)))

        # GTNH format: Blocks16/Data16 are ByteArrays of 8192 bytes (big-endian uint16 per entry)
        blocks16_tag = section.get("Blocks16")
        if blocks16_tag is not None and len(blocks16_tag) == 8192:
            raw16 = bytes([int(b) & 0xFF for b in blocks16_tag])
            blocks = list(struct.unpack(">4096H", raw16))

            data16_tag = section.get("Data16")
            if data16_tag is not None and len(data16_tag) == 8192:
                raw_d16 = bytes([int(b) & 0xFF for b in data16_tag])
                data = list(struct.unpack(">4096H", raw_d16))
            else:
                data = [0] * 4096

            sections.append(ChunkSection(y=y, blocks=blocks, data=data))
            continue

        # Vanilla format: Blocks (4096 uint8) + optional Add (nibble array) + Data (nibble array)
        blocks_tag = section.get("Blocks")
        if blocks_tag is None or len(blocks_tag) != 4096:
            continue

        blocks = [int(b) & 0xFF for b in blocks_tag]

        add_tag = section.get("Add")
        if add_tag:
            add_raw = bytes([int(b) & 0xFF for b in add_tag])
            add_nibbles = _parse_nibbles(add_raw)
            blocks = [b | (a << 8) for b, a in zip(blocks, add_nibbles, strict=False)]

        data_tag = section.get("Data")
        if data_tag is not None and len(data_tag) == 2048:
            data_raw = bytes([int(b) & 0xFF for b in data_tag])
            data = _parse_nibbles(data_raw)
        else:
            data = [0] * 4096

        sections.append(ChunkSection(y=y, blocks=blocks, data=data))

    return sorted(sections, key=lambda s: s.y)


def read_chunk_data(path: Path, local_x: int, local_z: int) -> RawChunkData:
    """Read full block data for a single chunk in a region file."""
    data = path.read_bytes()
    if len(data) < 2 * SECTOR_SIZE:
        raise ValueError(f"Region file is too small to be valid: {path.name}")

    idx = local_z * 32 + local_x
    loc = idx * 4
    raw = struct.unpack(">I", data[loc : loc + 4])[0]
    offset = raw >> 8

    if offset == 0:
        raise FileNotFoundError(f"Chunk ({local_x}, {local_z}) not present in region")

    raw_nbt = _decompress_chunk(data, offset)
    nbt_file = nbtlib.File.parse(io.BytesIO(raw_nbt))
    level = nbt_file["Level"]

    biomes_tag = level.get("Biomes")
    if biomes_tag is not None and len(biomes_tag) == 256:
        biomes = [int(b) & 0xFF for b in biomes_tag]
    else:
        biomes = []

    return RawChunkData(
        chunk_x=int(level["xPos"]),  # pyright: ignore[reportArgumentType]
        chunk_z=int(level["zPos"]),  # pyright: ignore[reportArgumentType]
        sections=_parse_sections(level),
        biomes=biomes,
    )
