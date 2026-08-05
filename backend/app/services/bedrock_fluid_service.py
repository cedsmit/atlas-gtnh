"""Combine seed-predicted underground fluids with Visual Prospecting data."""

from pathlib import Path
from typing import Any

import nbtlib

from app.models.bedrock_fluids import BedrockFluidField, BedrockFluidsResponse
from app.services.underground_fluid_generator import predict_bedrock_fluids
from app.services.visual_prospecting_service import (
    _find_dim_files,
    _read_world_id,
    _root_and_dim,
    _unnamed_get,
)

_FIELD_CHUNKS = 8
_CHUNK_BLOCKS = 16
_FIELD_BLOCKS = _FIELD_CHUNKS * _CHUNK_BLOCKS


def _decode_fields(fluids: Any) -> list[BedrockFluidField]:
    if fluids is None or "palette" not in fluids:
        return []
    palette = [str(value) for value in fluids.get("palette", [])]
    chunk_x = [int(value) for value in fluids.get("chunkX", [])]
    chunk_z = [int(value) for value in fluids.get("chunkZ", [])]
    fluid_types = [int(value) for value in fluids.get("fluidTypeIndex", [])]
    chunk_data = [int(value) for value in fluids.get("chunkData", [])]
    size = int(fluids.get("chunkDataSize", _FIELD_CHUNKS**2))
    if size <= 0:
        return []

    fields: list[BedrockFluidField] = []
    for index in range(min(len(chunk_x), len(chunk_z), len(fluid_types))):
        start = index * size
        raw_values = chunk_data[start : start + size]
        if len(raw_values) < size:
            break
        # VP stores chunks x-major (all Z values for X=0, then X=1, ...).
        # The API exposes conventional row-major Z rows for direct map grids.
        values = (
            [
                raw_values[x * _FIELD_CHUNKS + z]
                for z in range(_FIELD_CHUNKS)
                for x in range(_FIELD_CHUNKS)
            ]
            if size == _FIELD_CHUNKS**2
            else raw_values
        )
        type_index = fluid_types[index]
        fluid = palette[type_index] if 0 <= type_index < len(palette) else "unknown"
        positive = [value for value in values if value > 0]
        origin_x = chunk_x[index] * _CHUNK_BLOCKS
        origin_z = chunk_z[index] * _CHUNK_BLOCKS
        fields.append(
            BedrockFluidField(
                x=origin_x + _FIELD_BLOCKS // 2,
                z=origin_z + _FIELD_BLOCKS // 2,
                chunk_x=chunk_x[index],
                chunk_z=chunk_z[index],
                fluid=fluid,
                yields=values,
                min_yield=min(positive) if positive else 0,
                max_yield=max(positive) if positive else 0,
                empty=not positive,
                source="prospected",
            )
        )
    return fields


def _parse_fields(path: Path) -> list[BedrockFluidField]:
    nbt = nbtlib.load(str(path))
    return _decode_fields(_unnamed_get(nbt, "fluids"))


def get_bedrock_fluids(dimension_path: str) -> BedrockFluidsResponse:
    root, dim = _root_and_dim(dimension_path)
    world_id = _read_world_id(root)
    prediction_available, predicted = predict_bedrock_fluids(
        root, Path(dimension_path), dim, world_id
    )
    prospected: list[BedrockFluidField] = []
    if world_id is not None and dim is not None:
        for dim_file in _find_dim_files(root, world_id, dim):
            try:
                prospected = _parse_fields(dim_file)
                if prospected:
                    break
            except Exception:
                continue

    # Current/prospected data wins over the pristine prediction for the same
    # field, because pumping can lower its output after generation.
    merged = {(field.chunk_x, field.chunk_z): field for field in predicted}
    merged.update({(field.chunk_x, field.chunk_z): field for field in prospected})
    fields = sorted(merged.values(), key=lambda field: (field.chunk_x, field.chunk_z))
    return BedrockFluidsResponse(
        available=prediction_available or world_id is not None,
        prediction_available=prediction_available,
        prospected_count=len(prospected),
        predicted_count=sum(field.source == "predicted" for field in fields),
        fields=fields,
    )
