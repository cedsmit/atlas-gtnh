from pathlib import Path

from app.models.region import (
    ChunkData,
    ChunkMeta,
    ChunkSection,
    RegionDetail,
    RegionListResponse,
    RegionSummary,
)
from app.world.region_reader import read_chunk_data, read_region


def _region_coords_from_filename(name: str) -> tuple[int, int]:
    parts = name.split(".")
    return int(parts[1]), int(parts[2])


def list_regions(world_path: str) -> RegionListResponse:
    region_dir = Path(world_path) / "region"
    if not region_dir.is_dir():
        raise FileNotFoundError(f"No region directory found in: {world_path}")

    regions = [
        RegionSummary(region_x=rx, region_z=rz, file_name=f.name)
        for f in sorted(region_dir.glob("*.mca"))
        for rx, rz in [_region_coords_from_filename(f.name)]
    ]

    return RegionListResponse(
        world_path=world_path,
        region_count=len(regions),
        regions=regions,
    )


def get_chunk_data(world_path: str, cx: int, cz: int) -> ChunkData:
    rx = cx >> 5
    rz = cz >> 5
    lx = cx % 32
    lz = cz % 32

    region_file = Path(world_path) / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        raise FileNotFoundError(f"Region file not found for chunk ({cx}, {cz})")

    raw = read_chunk_data(region_file, lx, lz)
    return ChunkData(
        chunk_x=raw.chunk_x,
        chunk_z=raw.chunk_z,
        sections=[ChunkSection(y=s.y, blocks=s.blocks, data=s.data) for s in raw.sections],
    )


def get_region_detail(world_path: str, rx: int, rz: int) -> RegionDetail:
    region_file = Path(world_path) / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        raise FileNotFoundError(f"Region file not found: r.{rx}.{rz}.mca")

    raw_chunks, skipped = read_region(region_file)

    return RegionDetail(
        region_x=rx,
        region_z=rz,
        file_name=region_file.name,
        chunk_count=len(raw_chunks),
        skipped_chunks=skipped,
        chunks=[
            ChunkMeta(
                chunk_x=c.chunk_x,
                chunk_z=c.chunk_z,
                last_update=c.last_update,
                inhabited_time=c.inhabited_time,
                populated=c.populated,
            )
            for c in raw_chunks
        ],
    )
