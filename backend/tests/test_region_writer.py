import struct
import zlib
from pathlib import Path

from app.world.region_writer import (
    SECTOR_SIZE,
    backup_region,
    local_index,
    make_record,
    read_region_records,
    write_region_records,
)


def _payload(record: bytes) -> bytes:
    length = struct.unpack_from(">I", record, 0)[0]
    assert record[4] == 2  # zlib
    return zlib.decompress(record[5 : 4 + length])


def test_make_record_roundtrip() -> None:
    data = b"hello gtnh " * 500
    rec = make_record(data)
    assert _payload(rec) == data


def test_write_read_roundtrip(tmp_path: Path) -> None:
    records = {
        local_index(0, 0): (make_record(b"a" * 5000), 111),
        local_index(5, 9): (make_record(b"b" * 20000), 222),
        local_index(31, 31): (make_record(b"c" * 100), 333),
    }
    path = tmp_path / "r.0.0.mca"
    write_region_records(path, records)

    # Header present and file is sector-aligned.
    size = path.stat().st_size
    assert size % SECTOR_SIZE == 0
    assert size >= SECTOR_SIZE * 2

    back = read_region_records(path)
    assert set(back) == set(records)
    for i, (rec, ts) in records.items():
        assert back[i][0] == rec
        assert back[i][1] == ts
        assert _payload(back[i][0]) == _payload(rec)


def test_delete_chunk(tmp_path: Path) -> None:
    path = tmp_path / "r.0.0.mca"
    records = {
        local_index(1, 1): (make_record(b"keep" * 100), 1),
        local_index(2, 2): (make_record(b"drop" * 100), 2),
    }
    write_region_records(path, records)

    records = read_region_records(path)
    del records[local_index(2, 2)]
    write_region_records(path, records)

    back = read_region_records(path)
    assert set(back) == {local_index(1, 1)}


def test_copy_transplant_is_byte_exact(tmp_path: Path) -> None:
    src = tmp_path / "src.mca"
    dst = tmp_path / "dst.mca"
    idx = local_index(7, 3)
    write_region_records(src, {idx: (make_record(b"machine-nbt" * 400), 42)})

    src_records = read_region_records(src)
    dst_records = read_region_records(dst)  # missing → {}
    dst_records[idx] = src_records[idx]
    write_region_records(dst, dst_records)

    back = read_region_records(dst)
    assert back[idx][0] == src_records[idx][0]  # exact record bytes
    assert back[idx][1] == 42


def test_backup_once_preserves_original(tmp_path: Path) -> None:
    path = tmp_path / "r.0.0.mca"
    write_region_records(path, {local_index(0, 0): (make_record(b"original"), 1)})
    original = path.read_bytes()

    bak = backup_region(path)
    assert bak is not None and bak.read_bytes() == original

    # Mutate and back up again — the pristine snapshot must not change.
    write_region_records(path, {local_index(0, 0): (make_record(b"edited"), 2)})
    backup_region(path)
    assert bak.read_bytes() == original


def test_read_missing_file_is_empty(tmp_path: Path) -> None:
    assert read_region_records(tmp_path / "nope.mca") == {}
