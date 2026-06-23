from pydantic import BaseModel


class WorldValidateRequest(BaseModel):
    path: str


class WorldValidateResponse(BaseModel):
    valid: bool
    error: str | None = None
