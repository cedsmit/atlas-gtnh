from pydantic import BaseModel


class OreVein(BaseModel):
    """A GregTech ore vein cached by Visual Prospecting."""

    x: int  # world X of the vein anchor (jump/marker target)
    z: int  # world Z
    cx: int  # vein chunk coords (as stored by VP)
    cz: int
    kind: str  # VP palette name, e.g. "ore.mix.gold"
    depleted: bool  # true once the vein has been mined out
    # Enriched from the bundled ore-vein registry (ore_vein_dump.json). None when
    # this kind isn't in the registry (an unknown/modded vein, or no dump present) —
    # the frontend then falls back to its built-in name/colour table.
    name: str | None = None  # GTNH display name, e.g. "Magnetite & Gold"
    rgb: int | None = None  # representative material colour as 0xRRGGBB
    texture: str | None = None  # ore-texture key (best-effort; usually None)


class OreVeinsResponse(BaseModel):
    # False when this world has no Visual Prospecting data (the mod wasn't used,
    # or nothing was cached for this dimension) — the UI shows a hint instead.
    available: bool
    veins: list[OreVein]
    # Deduped ore-overlay PNGs (base64), keyed by icon name; each vein's ``texture``
    # is a key here. The frontend tints a sprite by the vein ``rgb`` (as GregTech
    # does at render). Empty when no dump/sprites are available, in which case the
    # frontend falls back to a flat colour dot.
    sprites: dict[str, str] = {}
    # Sprite keys that are pre-coloured (a material's ore art lives in its overlay,
    # not a tintable grayscale base — e.g. gold/iron/copper). The frontend draws
    # these as-is (no rgb tint), matching how GregTech renders them.
    sprites_precolored: list[str] = []
