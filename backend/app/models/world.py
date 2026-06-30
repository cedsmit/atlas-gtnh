from pydantic import BaseModel, Field


class WorldValidateRequest(BaseModel):
    path: str


class WorldValidateResponse(BaseModel):
    valid: bool
    error: str | None = None


class LoadDumpRequest(BaseModel):
    path: str  # Absolute path to icon_dump.json


class TexturesBatchRequest(BaseModel):
    world_path: str
    keys: list[str]  # texture keys ('domain:name') to fetch in one round-trip


class MissingReportBody(BaseModel):
    # On-map data from the client: block_id -> columns rendered, and metas seen.
    occurrences: dict[int, int] = Field(default_factory=dict)
    metas: dict[int, list[int]] = Field(default_factory=dict)
