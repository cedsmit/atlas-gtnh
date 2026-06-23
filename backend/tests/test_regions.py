import io
import struct
import zlib
from pathlib import Path

import nbtlib
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SECTOR_SIZE = 4096


def _make_chunk_nbt(chunk_x: int, chunk_z: int) -> bytes:
    nbt_file = nbtlib.File(
        {
            "Level": nbtlib.Compound(
                {
                    "xPos": nbtlib.Int(chunk_x),
                    "zPos": nbtlib.Int(chunk_z),
                    "LastUpdate": nbtlib.Long(100),
                    "InhabitedTime": nbtlib.Long(50),
                    "TerrainPopulated": nbtlib.Byte(1),
                    "LightPopulated": nbtlib.Byte(1),
                }
            )
        }
    )
    buf = io.BytesIO()
    nbt_file.write(buf)
    return buf.getvalue()


def _make_region_file(chunk_x: int = 0, chunk_z: int = 0) -> bytes:
    nbt_bytes = zlib.compress(_make_chunk_nbt(chunk_x, chunk_z))
    chunk_length = len(nbt_bytes) + 1  # +1 for compression type byte
    chunk_sectors = (chunk_length + 4 + SECTOR_SIZE - 1) // SECTOR_SIZE

    location_table = bytearray(SECTOR_SIZE)
    # Chunk at local (0, 0) → index 0: offset=2 sectors (after two header sectors)
    location_table[0:4] = struct.pack(">I", (2 << 8) | chunk_sectors)

    timestamp_table = bytearray(SECTOR_SIZE)

    chunk_data = bytearray(chunk_sectors * SECTOR_SIZE)
    chunk_data[0:4] = struct.pack(">I", chunk_length)
    chunk_data[4] = 2  # zlib compression
    chunk_data[5 : 5 + len(nbt_bytes)] = nbt_bytes

    return bytes(location_table) + bytes(timestamp_table) + bytes(chunk_data)


def _make_world(tmp: Path, region_data: bytes | None = None) -> Path:
    world = tmp / "test_world"
    world.mkdir()
    (world / "level.dat").touch()
    region_dir = world / "region"
    region_dir.mkdir()
    data = region_data if region_data is not None else _make_region_file()
    (region_dir / "r.0.0.mca").write_bytes(data)
    return world


def test_list_regions(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/regions", params={"world_path": str(world)})
    assert response.status_code == 200
    data = response.json()
    assert data["region_count"] == 1
    assert data["regions"][0]["file_name"] == "r.0.0.mca"


def test_list_regions_missing_world(tmp_path: Path) -> None:
    response = client.get("/worlds/regions", params={"world_path": str(tmp_path / "missing")})
    assert response.status_code == 404


def test_get_region_detail(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/regions/0/0", params={"world_path": str(world)})
    assert response.status_code == 200
    data = response.json()
    assert data["region_x"] == 0
    assert data["region_z"] == 0
    assert data["chunk_count"] == 1
    assert data["skipped_chunks"] == 0
    chunk = data["chunks"][0]
    assert chunk["chunk_x"] == 0
    assert chunk["chunk_z"] == 0
    assert chunk["populated"] is True


def test_get_region_detail_missing(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/regions/1/1", params={"world_path": str(world)})
    assert response.status_code == 404


def test_get_region_handles_corrupt_chunk(tmp_path: Path) -> None:
    world = tmp_path / "corrupt_world"
    world.mkdir()
    (world / "level.dat").touch()
    region_dir = world / "region"
    region_dir.mkdir()
    # Write a region file with valid header pointing to corrupt chunk data
    location_table = bytearray(SECTOR_SIZE)
    location_table[0:4] = struct.pack(">I", (2 << 8) | 1)
    corrupt_chunk = bytearray(SECTOR_SIZE)
    corrupt_chunk[0:4] = struct.pack(">I", 10)
    corrupt_chunk[4] = 2
    corrupt_chunk[5:15] = b"\xff" * 10  # invalid zlib data
    (region_dir / "r.0.0.mca").write_bytes(
        bytes(location_table) + bytes(SECTOR_SIZE) + bytes(corrupt_chunk)
    )
    response = client.get("/worlds/regions/0/0", params={"world_path": str(world)})
    assert response.status_code == 200
    data = response.json()
    assert data["skipped_chunks"] == 1
    assert data["chunk_count"] == 0


def test_get_region_invalid_file_too_small(tmp_path: Path) -> None:
    world = tmp_path / "small_world"
    world.mkdir()
    (world / "level.dat").touch()
    region_dir = world / "region"
    region_dir.mkdir()
    (region_dir / "r.0.0.mca").write_bytes(b"\x00" * 100)
    response = client.get("/worlds/regions/0/0", params={"world_path": str(world)})
    assert response.status_code == 400
