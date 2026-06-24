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


def _make_chunk_nbt_with_sections(chunk_x: int, chunk_z: int) -> bytes:
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
                    "Sections": nbtlib.List[nbtlib.Compound](
                        [
                            nbtlib.Compound(
                                {
                                    "Y": nbtlib.Byte(0),
                                    "Blocks": nbtlib.ByteArray([1] * 4096),  # all stone
                                    "Data": nbtlib.ByteArray([0] * 2048),
                                }
                            ),
                        ]
                    ),
                }
            )
        }
    )
    buf = io.BytesIO()
    nbt_file.write(buf)
    return buf.getvalue()


def _make_region_file_with_sections(chunk_x: int = 0, chunk_z: int = 0) -> bytes:
    nbt_bytes = zlib.compress(_make_chunk_nbt_with_sections(chunk_x, chunk_z))
    chunk_length = len(nbt_bytes) + 1
    chunk_sectors = (chunk_length + 4 + SECTOR_SIZE - 1) // SECTOR_SIZE

    location_table = bytearray(SECTOR_SIZE)
    location_table[0:4] = struct.pack(">I", (2 << 8) | chunk_sectors)

    timestamp_table = bytearray(SECTOR_SIZE)

    chunk_data = bytearray(chunk_sectors * SECTOR_SIZE)
    chunk_data[0:4] = struct.pack(">I", chunk_length)
    chunk_data[4] = 2  # zlib compression
    chunk_data[5 : 5 + len(nbt_bytes)] = nbt_bytes

    return bytes(location_table) + bytes(timestamp_table) + bytes(chunk_data)


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


def _make_world_with_dims(tmp: Path) -> Path:
    world = _make_world(tmp)
    nether = world / "DIM-1" / "region"
    nether.mkdir(parents=True)
    (nether / "r.0.0.mca").write_bytes(_make_region_file())
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


def test_get_chunk_data(tmp_path: Path) -> None:
    world = _make_world(tmp_path, _make_region_file_with_sections())
    response = client.get("/worlds/chunks/0/0", params={"world_path": str(world)})
    assert response.status_code == 200
    data = response.json()
    assert data["chunk_x"] == 0
    assert data["chunk_z"] == 0
    assert len(data["sections"]) == 1
    section = data["sections"][0]
    assert section["y"] == 0
    assert len(section["blocks"]) == 4096
    assert section["blocks"][0] == 1  # stone
    assert len(section["data"]) == 4096
    assert section["data"][0] == 0


def test_get_chunk_data_missing_chunk(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/chunks/1/0", params={"world_path": str(world)})
    assert response.status_code == 404


def test_get_chunk_data_missing_region(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/chunks/32/0", params={"world_path": str(world)})
    assert response.status_code == 404


def test_list_dimensions_overworld_only(tmp_path: Path) -> None:
    world = _make_world(tmp_path)
    response = client.get("/worlds/dimensions", params={"world_path": str(world)})
    assert response.status_code == 200
    dims = response.json()
    assert len(dims) == 1
    assert dims[0]["id"] == ""
    assert dims[0]["name"] == "Overworld"
    assert dims[0]["region_count"] == 1


def test_list_dimensions_with_nether(tmp_path: Path) -> None:
    world = _make_world_with_dims(tmp_path)
    response = client.get("/worlds/dimensions", params={"world_path": str(world)})
    assert response.status_code == 200
    dims = response.json()
    assert len(dims) == 2
    names = [d["name"] for d in dims]
    assert "Overworld" in names
    assert "Nether" in names


def test_list_dimensions_missing_world(tmp_path: Path) -> None:
    response = client.get("/worlds/dimensions", params={"world_path": str(tmp_path / "nope")})
    assert response.status_code == 404
