from app.models.search import SearchBlocksResponse
from app.services.search_index import ensure_index, query_index


def find_blocks(world_path: str, block_ids: list[int], limit: int = 500) -> SearchBlocksResponse:
    """Find the chunks containing any of *block_ids* in a dimension.

    Backed by the persistent block→chunks index: the first search for a world
    builds it (scans every chunk once — slow), and every search after that is an
    instant indexed lookup. The index rebuilds only when the world files change.
    Run off the event loop via ``asyncio.to_thread``.
    """
    ensure_index(world_path)
    return query_index(world_path, block_ids, limit)
