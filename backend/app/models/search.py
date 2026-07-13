from pydantic import BaseModel


class SearchHit(BaseModel):
    """A chunk containing one or more of the searched block ids."""

    cx: int  # chunk coords
    cz: int
    count: int  # matching blocks in this chunk
    x: int  # world coords of the first match (jump target / marker)
    y: int
    z: int


class SearchBlocksResponse(BaseModel):
    hits: list[SearchHit]
    total_matches: int  # total blocks found across returned hits
    hit_chunks: int  # number of matching chunks returned
    capped: bool  # true when the scan stopped at the limit (more may exist)
    block_ids: list[int]


class ChunkStatCell(BaseModel):
    cx: int
    cz: int
    v: int  # metric value for this chunk


class ChunkStatsResponse(BaseModel):
    metric: str
    cells: list[ChunkStatCell]
    vmin: int
    vmax: int
