import json
from pathlib import Path

from app.models.region import (
    ChunkData,
    ChunkMeta,
    ChunkSection,
    ChunkSurface,
    DimensionInfo,
    RegionDetail,
    RegionListResponse,
    RegionSummary,
    RegionSurfaceResponse,
)
from app.world.region_reader import (
    read_chunk_data,
    read_region,
    read_region_chunks,
    read_region_surface,
)

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


def _region_coords_from_filename(name: str) -> tuple[int, int] | None:
    """Parse 'r.<x>.<z>.mca' → (x, z), or None for a non-conforming name."""
    parts = name.split(".")
    if len(parts) < 3:
        return None
    try:
        return int(parts[1]), int(parts[2])
    except ValueError:
        return None


def list_regions(world_path: str) -> RegionListResponse:
    region_dir = Path(world_path) / "region"
    if not region_dir.is_dir():
        raise FileNotFoundError(f"No region directory found in: {world_path}")

    regions = []
    for f in sorted(region_dir.glob("*.mca")):
        coords = _region_coords_from_filename(f.name)
        if coords is None:
            continue  # skip oddly-named files instead of 500-ing the whole listing
        regions.append(RegionSummary(region_x=coords[0], region_z=coords[1], file_name=f.name))

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

    # A malformed/partially-written .mca raises struct/zlib/index errors from the
    # NBT parser; surface those as a 400 (ValueError) instead of a bare 500.
    try:
        raw = read_chunk_data(region_file, lx, lz)
    except (FileNotFoundError, ValueError):
        raise
    except Exception as e:
        raise ValueError(f"Corrupt chunk ({cx}, {cz}) in {region_file.name}: {e}") from e
    if not raw.sections:
        raise FileNotFoundError(f"Chunk ({cx}, {cz}) has no terrain data yet")
    return ChunkData(
        chunk_x=raw.chunk_x,
        chunk_z=raw.chunk_z,
        sections=[ChunkSection(y=s.y, blocks=s.blocks, data=s.data) for s in raw.sections],
        biomes=raw.biomes,
    )


def get_chunks_batch(world_path: str, coords: list[tuple[int, int]]) -> list[ChunkData]:
    """Read many chunks in one pass, reading each region file only once.

    Coords are grouped by region so a region's bytes are read (and cached) a
    single time regardless of how many of its chunks were requested.  Chunks
    that are absent or empty are simply omitted from the result; the caller
    diffs the request against the response to learn which came back empty.
    """
    region_root = Path(world_path) / "region"

    # Map (rx, rz) → { (local_x, local_z): (cx, cz) }
    by_region: dict[tuple[int, int], dict[tuple[int, int], tuple[int, int]]] = {}
    for cx, cz in coords:
        rx, rz = cx >> 5, cz >> 5
        by_region.setdefault((rx, rz), {})[(cx % 32, cz % 32)] = (cx, cz)

    out: list[ChunkData] = []
    for (rx, rz), wanted in by_region.items():
        region_file = region_root / f"r.{rx}.{rz}.mca"
        if not region_file.exists():
            continue
        try:
            chunks = read_region_chunks(region_file, set(wanted))
        except ValueError:
            continue
        for raw in chunks.values():
            out.append(
                ChunkData(
                    chunk_x=raw.chunk_x,
                    chunk_z=raw.chunk_z,
                    sections=[
                        ChunkSection(y=s.y, blocks=s.blocks, data=s.data) for s in raw.sections
                    ],
                    biomes=raw.biomes,
                )
            )
    return out


def get_region_surface(world_path: str, rx: int, rz: int) -> RegionSurfaceResponse:
    """Compact per-column surface summary for every chunk in a region.

    Used to render a single low-detail tile per region for the zoomed-out
    overview, instead of one full-resolution texture per chunk.
    """
    region_file = Path(world_path) / "region" / f"r.{rx}.{rz}.mca"
    if not region_file.exists():
        raise FileNotFoundError(f"Region file not found: r.{rx}.{rz}.mca")

    surfaces = read_region_surface(region_file)
    return RegionSurfaceResponse(
        region_x=rx,
        region_z=rz,
        chunks=[
            ChunkSurface(
                chunk_x=s.chunk_x,
                chunk_z=s.chunk_z,
                ids=s.ids,
                metas=s.metas,
                heights=s.heights,
                biomes=s.biomes,
            )
            for s in surfaces
        ],
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
