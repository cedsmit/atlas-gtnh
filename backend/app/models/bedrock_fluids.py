from typing import Literal

from pydantic import BaseModel


class BedrockFluidField(BaseModel):
    """One 8x8-chunk underground-fluid field, measured or seed-predicted."""

    x: int  # world-space centre, used for labels and fly-to
    z: int
    chunk_x: int  # north-west field origin in chunk coordinates
    chunk_z: int
    fluid: str  # registry key, e.g. gas_natural_gas
    yields: list[int]  # row-major 8x8 L/operation values
    min_yield: int
    max_yield: int
    empty: bool
    # A prospected field contains the current value reported by the server. A
    # predicted field is the pristine GT value reconstructed from seed + config.
    source: Literal["predicted", "prospected"]


class BedrockFluidsResponse(BaseModel):
    available: bool
    prediction_available: bool
    prospected_count: int
    predicted_count: int
    fields: list[BedrockFluidField]
