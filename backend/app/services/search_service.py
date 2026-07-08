from pathlib import Path

import numpy as np

from app.models.search import SearchBlocksResponse, SearchHit
from app.world.region_reader import scan_region_for_blocks


def find_blocks(world_path: str, block_ids: list[int], limit: int = 500) -> SearchBlocksResponse:
    """Scan a dimension's chunks for any of *block_ids* and return matching chunks.

    Scans full 3-D block data (surface and underground). Stops once *limit* matching
    chunks are collected (``capped=True``) so large worlds stay responsive; refine the
    query when capped. Run off the event loop via ``asyncio.to_thread``.
    """
    region_dir = Path(world_path) / "region"
    if not region_dir.is_dir():
        raise FileNotFoundError(f"No region directory under {world_path}")

    ids = sorted({int(b) for b in block_ids if 0 < int(b) < 65536})
    if not ids:
        return SearchBlocksResponse(
            hits=[], total_matches=0, hit_chunks=0, capped=False, block_ids=[]
        )
    id_arr = np.fromiter(ids, dtype=np.uint16)

    hits: list[SearchHit] = []
    total = 0
    capped = False
    for region_file in sorted(region_dir.glob("*.mca")):
        for h in scan_region_for_blocks(region_file, id_arr):
            if len(hits) >= limit:
                capped = True
                break
            hits.append(SearchHit(cx=h.chunk_x, cz=h.chunk_z, count=h.count, x=h.x, y=h.y, z=h.z))
            total += h.count
        if capped:
            break

    return SearchBlocksResponse(
        hits=hits,
        total_matches=total,
        hit_chunks=len(hits),
        capped=capped,
        block_ids=ids,
    )
