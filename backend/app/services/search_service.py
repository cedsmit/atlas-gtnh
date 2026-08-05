from app.models.search import BiomePresence, SearchBlocksResponse
from app.services.search_index import (
    biomes_present,
    ensure_index,
    query_biomes,
    query_index,
)


def find_blocks(
    world_path: str,
    block_ids: list[int],
    limit: int = 500,
    progress: object = None,
    cancelled: object = None,
) -> SearchBlocksResponse:
    """Find the chunks containing any of *block_ids* in a dimension.

    Backed by the persistent block→chunks index: the first search for a world
    builds it (scans every chunk once — slow), and every search after that is an
    instant indexed lookup. The index rebuilds only when the world files change.
    Run off the event loop via ``asyncio.to_thread``.
    """
    ensure_index(world_path, progress, cancelled)  # type: ignore[arg-type]
    return query_index(world_path, block_ids, limit)


def find_biomes(
    world_path: str,
    biome_ids: list[int],
    limit: int = 500,
    progress: object = None,
    cancelled: object = None,
) -> SearchBlocksResponse:
    """Find the chunks containing any of *biome_ids* in a dimension.

    Shares the persistent index (biomes are indexed in the same build pass as
    blocks), so it's instant after the one-time build. Run off the event loop.
    """
    ensure_index(world_path, progress, cancelled)  # type: ignore[arg-type]
    return query_biomes(world_path, biome_ids, limit)


def list_biomes(
    world_path: str, progress: object = None, cancelled: object = None
) -> list[BiomePresence]:
    """The biomes actually present in a dimension (from the index), widest first.

    Builds the index on first call, then instant. Run off the event loop.
    """
    ensure_index(world_path, progress, cancelled)  # type: ignore[arg-type]
    return biomes_present(world_path)
