from pydantic import BaseModel


class ChunkMeta(BaseModel):
    chunk_x: int
    chunk_z: int
    last_update: int
    inhabited_time: int
    populated: bool


class RegionSummary(BaseModel):
    region_x: int
    region_z: int
    file_name: str


class RegionListResponse(BaseModel):
    world_path: str
    region_count: int
    regions: list[RegionSummary]


class RegionDetail(BaseModel):
    region_x: int
    region_z: int
    file_name: str
    chunk_count: int
    skipped_chunks: int
    chunks: list[ChunkMeta]
