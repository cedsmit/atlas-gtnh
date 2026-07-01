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


class ChunkSection(BaseModel):
    y: int
    blocks: list[int]  # 4096 block IDs (0-4095)
    data: list[int]  # 4096 metadata nibbles (0-15)


class ChunkData(BaseModel):
    chunk_x: int
    chunk_z: int
    sections: list[ChunkSection]
    biomes: list[int] = []  # 256 biome IDs (x + z*16), empty when not stored


class ChunkSurface(BaseModel):
    chunk_x: int
    chunk_z: int
    ids: list[int]  # 256, top non-air block id per column (x + z*16); 0 = empty
    metas: list[int]  # 256
    heights: list[int]  # 256, absolute Y of the top block; -1 = empty
    biomes: list[int] = []  # 256, or empty when not stored


class RegionSurfaceResponse(BaseModel):
    region_x: int
    region_z: int
    chunks: list[ChunkSurface]


class ChunkBatchRequest(BaseModel):
    world_path: str
    coords: list[tuple[int, int]]  # [(chunk_x, chunk_z), ...]


class ChunkBatchResponse(BaseModel):
    chunks: list[ChunkData]


class DeleteChunksRequest(BaseModel):
    world_path: str  # dimension path (its region/ holds the .mca files)
    chunks: list[tuple[int, int]]  # [(chunk_x, chunk_z), ...] to delete for regen


class DeleteExceptRequest(BaseModel):
    world_path: str  # dimension path
    keep: list[tuple[int, int]]  # chunks to KEEP; every other generated chunk is deleted


class CopyChunksRequest(BaseModel):
    src_world: str  # source dimension path
    dst_world: str  # destination dimension path
    chunks: list[tuple[int, int]]  # source chunk coords
    offset: tuple[int, int] = (0, 0)  # (dx, dz) chunk offset applied at the destination


class CreateWorldRequest(BaseModel):
    src_world: str  # source dimension path
    new_world_path: str  # new world folder to create (must be empty/absent)
    chunks: list[tuple[int, int]]
    offset: tuple[int, int] = (0, 0)


class DimensionInfo(BaseModel):
    id: str  # e.g. "", "DIM-1", "DIM1", "DIM42"
    name: str  # e.g. "Overworld", "Nether", "The End"
    path: str  # absolute path to the dimension folder
    region_count: int
