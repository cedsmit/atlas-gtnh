import json
from pathlib import Path

from app.models.region import (
    ChunkData,
    ChunkMeta,
    ChunkSection,
    DimensionInfo,
    RegionDetail,
    RegionListResponse,
    RegionSummary,
)
from app.world.region_reader import read_chunk_data, read_region

_DIMS_FILE = Path(__file__).parent.parent / "data" / "dimensions.json"
_KNOWN_DIMS: dict[str, str] = json.loads(_DIMS_FILE.read_text(encoding="utf-8"))


def _dim_name(dim_id: str) -> str:
    return _KNOWN_DIMS.get(dim_id, f"Dimension {dim_id.removeprefix('DIM')}")


def list_dimensions(world_path: str) -> list[DimensionInfo]:
    root = Path(world_path)
    if not root.is_dir():
        raise FileNotFoundError(f"World not found: {world_path}")

    dims: list[DimensionInfo] = []

    region_dir = root / "region"
    overworld_regions = list(region_dir.glob("*.mca")) if region_dir.is_dir() else []
    if overworld_regions:
        dims.append(
            DimensionInfo(
                id="", name="Overworld", path=str(root), region_count=len(overworld_regions)
            )
        )

    for dim_dir in sorted(root.glob("DIM*")):
        if not dim_dir.is_dir():
            continue
        dim_region_dir = dim_dir / "region"
        mca_files = list(dim_region_dir.glob("*.mca")) if dim_region_dir.is_dir() else []
        if mca_files:
            dims.append(
                DimensionInfo(
                    id=dim_dir.name,
                    name=_dim_name(dim_dir.name),
                    path=str(dim_dir),
                    region_count=len(mca_files),
                )
            )

    return dims


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
