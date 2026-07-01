"""Low-level Minecraft Anvil (.mca) region-file writer.

region_reader.py is read-only; this adds the write path needed for chunk
copy/paste and delete-for-regeneration.

To avoid fiddly in-place sector-allocation bugs, every mutation reads the whole
region into a ``{loc_index: (record, timestamp)}`` map, edits that map, and
rewrites the file from scratch (region files are only a few MB). The rewrite goes
to a temp file that is atomically renamed over the original, and a one-time
``.bak`` snapshot is taken first — so a crash can never leave a half-written save.

Region layout: an 8 KiB header (a 4 KiB location table of 1024 big-endian
``offset<<8 | sector_count`` entries, then a 4 KiB timestamp table), followed by
sector-aligned chunk records. Each record is ``[4B length][1B compression][payload]``
where length counts the compression byte + payload.
"""

from __future__ import annotations

import shutil
import struct
import zlib
from pathlib import Path

SECTOR_SIZE = 4096
_HEADER_SECTORS = 2  # 8 KiB header: location table + timestamp table
_COMPRESSION_ZLIB = 2


def local_index(local_x: int, local_z: int) -> int:
    """Location-table index for a chunk's position within its region (0-1023)."""
    return local_x + local_z * 32


def read_region_records(path: Path) -> dict[int, tuple[bytes, int]]:
    """Return ``{loc_index: (record_bytes, timestamp)}`` for every present chunk.

    ``record_bytes`` is the raw ``[len][compression][payload]`` (not sector-padded),
    so records can be transplanted between region files verbatim. A missing or
    truncated file yields an empty map.
    """
    if not path.exists():
        return {}
    data = path.read_bytes()
    if len(data) < SECTOR_SIZE * _HEADER_SECTORS:
        return {}

    out: dict[int, tuple[bytes, int]] = {}
    for i in range(1024):
        raw = struct.unpack_from(">I", data, i * 4)[0]
        offset, sectors = raw >> 8, raw & 0xFF
        if offset == 0 or sectors == 0:
            continue
        byte_off = offset * SECTOR_SIZE
        if byte_off + 4 > len(data):
            continue  # location entry points past EOF — skip the corrupt slot
        length = struct.unpack_from(">I", data, byte_off)[0]  # compression byte + payload
        record = data[byte_off : byte_off + 4 + length]
        if len(record) != 4 + length:
            continue  # truncated record
        ts = struct.unpack_from(">I", data, SECTOR_SIZE + i * 4)[0]
        out[i] = (record, ts)
    return out


def write_region_records(path: Path, records: dict[int, tuple[bytes, int]]) -> None:
    """Serialise *records* into a valid .mca at *path*, atomically.

    Rebuilds the location + timestamp tables and packs each record into
    consecutive sectors. Writes a temp file and renames it over the target.
    """
    loc = bytearray(SECTOR_SIZE)
    ts_table = bytearray(SECTOR_SIZE)
    body = bytearray()
    next_sector = _HEADER_SECTORS

    for i in range(1024):
        rec = records.get(i)
        if rec is None:
            continue
        record, ts = rec
        pad = (-len(record)) % SECTOR_SIZE
        sectors = (len(record) + pad) // SECTOR_SIZE
        if sectors > 0xFF:
            raise ValueError(f"chunk record at index {i} too large ({sectors} sectors > 255)")
        struct.pack_into(">I", loc, i * 4, (next_sector << 8) | sectors)
        struct.pack_into(">I", ts_table, i * 4, ts & 0xFFFFFFFF)
        body += record + b"\x00" * pad
        next_sector += sectors

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(bytes(loc) + bytes(ts_table) + bytes(body))
    tmp.replace(path)


def make_record(nbt_bytes: bytes) -> bytes:
    """Compress raw chunk NBT into a region record (``[len][zlib][payload]``)."""
    payload = zlib.compress(nbt_bytes)
    return struct.pack(">I", len(payload) + 1) + bytes([_COMPRESSION_ZLIB]) + payload


def backup_region(path: Path) -> Path | None:
    """Snapshot *path* to ``<name>.bak`` once (kept as the pristine pre-edit copy).

    Never overwrites an existing backup, so the earliest original is preserved.
    Returns the backup path, or None if there was nothing to back up.
    """
    if not path.exists():
        return None
    bak = path.with_name(path.name + ".bak")
    if not bak.exists():
        shutil.copy2(path, bak)
    return bak
