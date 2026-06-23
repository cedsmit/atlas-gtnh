from fastapi import APIRouter

from app.models.world import WorldValidateRequest, WorldValidateResponse
from app.services.world_validator import validate_world_path

router = APIRouter(prefix="/worlds", tags=["worlds"])


@router.post("/validate", response_model=WorldValidateResponse)
async def validate_world(request: WorldValidateRequest) -> WorldValidateResponse:
    valid, error = validate_world_path(request.path)
    return WorldValidateResponse(valid=valid, error=error)
