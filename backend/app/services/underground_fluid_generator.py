"""Reproduce GregTech 5's deterministic underground-fluid generator.

Underground fluids are not blocks and therefore cannot be recovered by scanning
Anvil chunks like ore veins can. GregTech derives every 8x8-chunk field from the
world seed, dimension id, and ``UndergroundFluids.cfg``. This module ports that
small generator so Atlas can show pristine, unprospected fields in generated map
areas. Prospected values are merged by ``bedrock_fluid_service`` because those
may reflect depletion.
"""

from __future__ import annotations

import math
import os
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path

import nbtlib

from app.models.bedrock_fluids import BedrockFluidField
from app.services.region_service import _dim_name, _region_coords_from_filename

_FIELD_CHUNKS = 8
_CHUNK_BLOCKS = 16
_FIELD_BLOCKS = _FIELD_CHUNKS * _CHUNK_BLOCKS
_DIVIDER = 5000
_MASK_32 = (1 << 32) - 1
_MASK_64 = (1 << 64) - 1
_CONFIG_ENV = "ATLAS_UNDERGROUND_FLUIDS_CONFIG_PATH"


@dataclass(frozen=True)
class FluidDefinition:
    registry: str
    minimum: int
    maximum: int
    chance: int


@dataclass(frozen=True)
class DimensionFluidConfig:
    dimension: str
    fluids: tuple[FluidDefinition, ...]


@dataclass
class _ConfigNode:
    name: str
    properties: dict[str, str] = field(default_factory=dict)
    children: list[_ConfigNode] = field(default_factory=list)


class _XSTR:
    """Bit-for-bit port of GT's XSTR methods used by UndergroundOil."""

    def __init__(self, seed: int) -> None:
        self.seed = seed & _MASK_64

    def _step(self) -> int:
        value = self.seed
        value ^= (value << 21) & _MASK_64
        value ^= value >> 35
        value ^= (value << 4) & _MASK_64
        self.seed = value & _MASK_64
        return self.seed

    def next(self, bits: int) -> int:
        return self._step() & ((1 << bits) - 1)

    def next_int(self, bound: int) -> int:
        if bound <= 0:
            raise ValueError("bound must be positive")
        # XSTR overrides Random.nextInt(bound): cast the new long state to a
        # signed Java int, take Java's remainder, then make it positive.
        value = self._step() & _MASK_32
        signed = value - (1 << 32) if value & (1 << 31) else value
        remainder = signed % bound if signed >= 0 else -((-signed) % bound)
        return abs(remainder)

    def next_double(self) -> float:
        return ((self.next(26) << 27) + self.next(27)) / float(1 << 53)

    def next_float(self) -> float:
        return _float32(self.next(24) / float(1 << 24))


def _float32(value: float) -> float:
    return float(struct.unpack(">f", struct.pack(">f", value))[0])


def _int32(value: int) -> int:
    value &= _MASK_32
    return value - (1 << 32) if value & (1 << 31) else value


def _java_string_hash(value: str) -> int:
    result = 0
    encoded = value.encode("utf-16-be")
    for index in range(0, len(encoded), 2):
        code_unit = int.from_bytes(encoded[index : index + 2], "big")
        result = _int32(result * 31 + code_unit)
    return result


def _guava_smear(value: int) -> int:
    product = (_int32(value * -862048943)) & _MASK_32
    rotated = ((product << 15) | (product >> 17)) & _MASK_32
    return _int32(rotated * 461845907)


def _guava_hash_bimap_order(
    fluids: list[FluidDefinition],
) -> tuple[FluidDefinition, ...]:
    """Match Guava 17 HashBiMap.entrySet iteration used by GTUODimension.

    GT inserts config-order entries into a 16-bucket HashBiMap but selects a
    random fluid in hash-bucket order. Using config order changes the fluid type
    while leaving yields deceptively plausible, so this detail matters.
    """

    table: list[list[FluidDefinition]] = [[] for _ in range(16)]
    count = 0
    for fluid in fluids:
        bucket = _guava_smear(_java_string_hash(fluid.registry)) & (len(table) - 1)
        table[bucket].insert(0, fluid)
        count += 1
        if count > len(table):
            old_table = table
            table = [[] for _ in range(len(old_table) * 2)]
            for old_bucket in old_table:
                for old_fluid in old_bucket:
                    new_bucket = _guava_smear(_java_string_hash(old_fluid.registry)) & (
                        len(table) - 1
                    )
                    table[new_bucket].insert(0, old_fluid)
    return tuple(fluid for bucket in table for fluid in bucket)


def _parse_config_nodes(text: str) -> list[_ConfigNode]:
    roots: list[_ConfigNode] = []
    stack: list[_ConfigNode] = []
    category_re = re.compile(r'^\s*"?([^"{}]+?)"?\s*\{\s*$')
    property_re = re.compile(r"^\s*[A-Z]:([^=]+)=(.*)$")
    in_list = False

    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if in_list:
            if line == ">":
                in_list = False
            continue
        if re.match(r"^[A-Z]:[^<]+<\s*$", line):
            in_list = True
            continue
        category = category_re.match(line)
        if category:
            node = _ConfigNode(name=category.group(1).strip())
            if stack:
                stack[-1].children.append(node)
            else:
                roots.append(node)
            stack.append(node)
            continue
        if line == "}":
            if stack:
                stack.pop()
            continue
        prop = property_re.match(line)
        if prop and stack:
            stack[-1].properties[prop.group(1).strip()] = prop.group(2).strip().strip('"')
    return roots


def _load_fluid_config(path: Path) -> tuple[frozenset[int], tuple[DimensionFluidConfig, ...]]:
    text = path.read_text(encoding="utf-8")
    roots = _parse_config_nodes(text)
    root = next((node for node in roots if node.name.lower() == "undergroundfluid"), None)
    if root is None:
        return frozenset(), ()

    blacklist_match = re.search(r"I:DimBlackList\s*<(?P<values>.*?)>", text, re.DOTALL)
    blacklist = (
        frozenset(int(value) for value in re.findall(r"-?\d+", blacklist_match.group("values")))
        if blacklist_match
        else frozenset()
    )
    dimensions: list[DimensionFluidConfig] = []
    for dimension_node in root.children:
        dimension = dimension_node.properties.get("Dimension")
        if not dimension:
            continue
        fluids: list[FluidDefinition] = []
        for fluid_node in dimension_node.children:
            props = fluid_node.properties
            try:
                fluids.append(
                    FluidDefinition(
                        registry=props["Registry"],
                        minimum=int(props["MinAmount"]),
                        maximum=int(props["MaxAmount"]),
                        chance=int(props["Chance"]),
                    )
                )
            except (KeyError, ValueError):
                continue
        if fluids:
            dimensions.append(
                DimensionFluidConfig(
                    dimension=dimension,
                    fluids=_guava_hash_bimap_order(fluids),
                )
            )
    return blacklist, tuple(dimensions)


def _find_config(world_root: Path, world_id: str | None = None) -> Path | None:
    override = os.environ.get(_CONFIG_ENV, "").strip()
    if override:
        path = Path(override).expanduser()
        return path if path.is_file() else None

    # Dedicated server: <server>/World + <server>/config. Singleplayer:
    # <instance>/saves/World + <instance>/config.
    for base in [world_root.parent, *world_root.parents[1:3]]:
        candidate = base / "config" / "GregTech" / "UndergroundFluids.cfg"
        if candidate.is_file():
            return candidate

    # A multiplayer backup is often just the World directory, stored nowhere
    # near the client instance. Visual Prospecting's world id gives us an exact
    # bridge back to the Prism/MultiMC instance whose GT config generated it.
    if world_id:
        roaming = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        for launcher in ("PrismLauncher", "MultiMC"):
            instances = roaming / launcher / "instances"
            if not instances.is_dir():
                continue
            matches = sorted(instances.glob(f"*/.minecraft/visualprospecting/client/*/{world_id}"))
            for vp_world in matches:
                minecraft_dir = vp_world.parents[3]
                candidate = minecraft_dir / "config" / "GregTech" / "UndergroundFluids.cfg"
                if candidate.is_file():
                    return candidate
    return None


def _read_seed(world_root: Path) -> int | None:
    try:
        level = nbtlib.load(str(world_root / "level.dat"))
        data = level.get("Data")
        seed = data.get("RandomSeed") if hasattr(data, "get") else None
        return int(seed) if seed is not None else None
    except Exception:
        return None


def _normalise_dimension(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _select_dimension_config(
    configs: tuple[DimensionFluidConfig, ...], dimension_id: int, dimension_path: Path
) -> DimensionFluidConfig | None:
    numeric = str(dimension_id)
    for config in configs:
        if config.dimension == numeric:
            return config

    dim_key = "DIM0" if dimension_id == 0 else f"DIM{dimension_id}"
    names = {
        _normalise_dimension(_dim_name(dim_key)),
        _normalise_dimension(dimension_path.name),
    }
    # GT's provider substring is aCentauriBb while Atlas' friendly name is
    # Alpha Centauri Bb.
    if "alphacentauribb" in names:
        names.add("acentauribb")
    for config in configs:
        if _normalise_dimension(config.dimension) in names:
            return config
    return next((config for config in configs if config.dimension == "Default"), None)


def _generated_field_origins(dimension_path: Path) -> set[tuple[int, int]]:
    """8x8-chunk fields containing at least one chunk present in an MCA header."""

    origins: set[tuple[int, int]] = set()
    region_dir = dimension_path / "region"
    for region_file in region_dir.glob("r.*.*.mca"):
        coords = _region_coords_from_filename(region_file.name)
        if coords is None:
            continue
        try:
            with region_file.open("rb") as handle:
                locations = handle.read(4096)
        except OSError:
            continue
        region_x, region_z = coords
        for index in range(min(1024, len(locations) // 4)):
            location = int.from_bytes(locations[index * 4 : index * 4 + 4], "big")
            if location >> 8 == 0 or location & 0xFF == 0:
                continue
            chunk_x = region_x * 32 + index % 32
            chunk_z = region_z * 32 + index // 32
            origins.add(
                (
                    (chunk_x // _FIELD_CHUNKS) * _FIELD_CHUNKS,
                    (chunk_z // _FIELD_CHUNKS) * _FIELD_CHUNKS,
                )
            )
    return origins


def _pow_int_five(value: float) -> float:
    # GTUtility.powBySquaring(value, 5): preserve Java's multiplication order.
    squared = value * value
    fourth = squared * squared
    return value * fourth


def _random_average(random: _XSTR, fluid: FluidDefinition) -> int:
    scaled_max = fluid.maximum * 100.0 * _DIVIDER
    scaled_min = fluid.minimum * 100.0 * _DIVIDER
    maximum = math.floor(math.pow(scaled_max, 0.2))
    minimum = math.pow(scaled_min, 0.2)
    sampled = max(minimum, random.next_int(maximum) + random.next_double())
    return int(_pow_int_five(sampled) / 100.0)


def _select_fluid(random: _XSTR, fluids: tuple[FluidDefinition, ...]) -> FluidDefinition | None:
    total_chance = sum(fluid.chance for fluid in fluids)
    if total_chance <= 0:
        return None
    roll = random.next_int(1000)
    for fluid in fluids:
        chance = fluid.chance * 1000 // total_chance
        if roll <= chance:
            return fluid
        roll -= chance
    return None


def _predict_field(
    world_seed: int,
    dimension_id: int,
    origin_x: int,
    origin_z: int,
    config: DimensionFluidConfig,
) -> BedrockFluidField:
    random = _XSTR(world_seed + dimension_id * 2 + (origin_x >> 3) + 8267 * (origin_z >> 3))
    fluid = _select_fluid(random, config.fluids)
    if fluid is None:
        values = [0] * (_FIELD_CHUNKS**2)
        registry = "empty"
    else:
        average = _random_average(random, fluid)
        # GT restarts the field RNG for every chunk and discards one 24-bit
        # value per earlier x-major cell. That is equivalent to consuming the
        # 64 floats once here, then transposing to the API's row-major layout.
        x_major: list[int] = []
        for _ in range(_FIELD_CHUNKS**2):
            factor = _float32(_float32(0.75) + _float32(random.next_float() / _float32(2.0)))
            amount = int(_float32(_float32(float(average)) * factor))
            x_major.append(amount // _DIVIDER if amount > _DIVIDER else 0)
        values = [
            x_major[x * _FIELD_CHUNKS + z]
            for z in range(_FIELD_CHUNKS)
            for x in range(_FIELD_CHUNKS)
        ]
        registry = fluid.registry

    positive = [value for value in values if value > 0]
    return BedrockFluidField(
        x=origin_x * _CHUNK_BLOCKS + _FIELD_BLOCKS // 2,
        z=origin_z * _CHUNK_BLOCKS + _FIELD_BLOCKS // 2,
        chunk_x=origin_x,
        chunk_z=origin_z,
        fluid=registry,
        yields=values,
        min_yield=min(positive) if positive else 0,
        max_yield=max(positive) if positive else 0,
        empty=not positive,
        source="predicted",
    )


def predict_bedrock_fluids(
    world_root: Path,
    dimension_path: Path,
    dimension_id: int | None,
    world_id: str | None = None,
) -> tuple[bool, list[BedrockFluidField]]:
    """Return (prediction available, pristine fields in generated terrain)."""

    if dimension_id is None:
        return False, []
    config_path = _find_config(world_root, world_id)
    world_seed = _read_seed(world_root)
    if config_path is None or world_seed is None:
        return False, []
    try:
        blacklist, configs = _load_fluid_config(config_path)
    except (OSError, UnicodeError):
        return False, []
    if dimension_id in blacklist:
        return True, []
    config = _select_dimension_config(configs, dimension_id, dimension_path)
    if config is None:
        return False, []
    origins = _generated_field_origins(dimension_path)
    fields = [
        _predict_field(world_seed, dimension_id, chunk_x, chunk_z, config)
        for chunk_x, chunk_z in sorted(origins)
    ]
    return True, fields
