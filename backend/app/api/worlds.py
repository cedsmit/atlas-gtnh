from fastapi import APIRouter, HTTPException, Query

from app.models.region import RegionDetail, RegionListResponse
from app.models.world import WorldValidateRequest, WorldValidateResponse
from app.services.region_service import get_region_detail, list_regions
from app.services.world_validator import validate_world_path

router = APIRouter(prefix="/worlds", tags=["worlds"])


@router.post("/validate", response_model=WorldValidateResponse)
async def validate_world(request: WorldValidateRequest) -> WorldValidateResponse:
    valid, error = validate_world_path(request.path)
    return WorldValidateResponse(valid=valid, error=error)


@router.get("/regions", response_model=RegionListResponse)
async def list_world_regions(world_path: str = Query(...)) -> RegionListResponse:
    try:
        return list_regions(world_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/regions/{rx}/{rz}", response_model=RegionDetail)
async def get_world_region(rx: int, rz: int, world_path: str = Query(...)) -> RegionDetail:
    try:
        return get_region_detail(world_path, rx, rz)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
