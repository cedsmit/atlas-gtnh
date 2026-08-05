from pathlib import Path

from pytest import MonkeyPatch

from app.models.bedrock_fluids import BedrockFluidField
from app.services import bedrock_fluid_service
from app.services.bedrock_fluid_service import _decode_fields
from app.services.underground_fluid_generator import (
    DimensionFluidConfig,
    FluidDefinition,
    _find_config,
    _generated_field_origins,
    _guava_hash_bimap_order,
    _load_fluid_config,
    _predict_field,
)
from app.services.visual_prospecting_service import _find_dim_file, _find_dim_files

_OVERWORLD_FLUIDS = [
    FluidDefinition("gas_natural_gas", 10, 350, 20),
    FluidDefinition("liquid_light_oil", 10, 350, 20),
    FluidDefinition("liquid_medium_oil", 0, 625, 20),
    FluidDefinition("liquid_heavy_oil", 0, 625, 20),
    FluidDefinition("oil", 0, 625, 20),
]


def test_decode_fields_reads_yields_and_world_centre() -> None:
    values = list(range(1, 65))
    fields = _decode_fields(
        {
            "palette": ["gas_natural_gas"],
            "chunkX": [-8],
            "chunkZ": [16],
            "fluidTypeIndex": [0],
            "chunkData": values,
            "chunkDataSize": 64,
        }
    )

    assert len(fields) == 1
    field = fields[0]
    assert (field.x, field.z) == (-64, 320)
    assert field.fluid == "gas_natural_gas"
    assert field.source == "prospected"
    assert field.yields[:8] == [1, 9, 17, 25, 33, 41, 49, 57]
    assert (field.min_yield, field.max_yield, field.empty) == (1, 64, False)


def test_decode_fields_marks_zero_field_empty() -> None:
    [field] = _decode_fields(
        {
            "palette": ["oil"],
            "chunkX": [0],
            "chunkZ": [0],
            "fluidTypeIndex": [0],
            "chunkData": [0] * 64,
            "chunkDataSize": 64,
        }
    )

    assert field.empty is True
    assert field.min_yield == field.max_yield == 0


def test_decode_fields_ignores_truncated_record() -> None:
    assert (
        _decode_fields(
            {
                "palette": ["oil"],
                "chunkX": [0],
                "chunkZ": [0],
                "fluidTypeIndex": [0],
                "chunkData": [1, 2],
                "chunkDataSize": 64,
            }
        )
        == []
    )


def test_find_dim_file_supports_namespaced_client_cache(tmp_path: Path) -> None:
    world = tmp_path / "instance" / "saves" / "World"
    world.mkdir(parents=True)
    dim_file = (
        tmp_path
        / "instance"
        / "visualprospecting"
        / "client"
        / "server-id"
        / "World_uuid"
        / "DIM0.dat"
    )
    dim_file.parent.mkdir(parents=True)
    dim_file.touch()

    assert _find_dim_file(world, "World_uuid", 0) == dim_file
    assert _find_dim_files(world, "World_uuid", 0) == [dim_file]


def test_guava_hash_order_matches_gtnh_fluid_selection_order() -> None:
    assert [fluid.registry for fluid in _guava_hash_bimap_order(_OVERWORLD_FLUIDS)] == [
        "liquid_light_oil",
        "liquid_medium_oil",
        "oil",
        "gas_natural_gas",
        "liquid_heavy_oil",
    ]


def test_predict_field_matches_known_gtnh_290_world_result() -> None:
    config = DimensionFluidConfig("0", _guava_hash_bimap_order(_OVERWORLD_FLUIDS))

    field = _predict_field(-743792462389800782, 0, -16, 16, config)

    assert field.fluid == "gas_natural_gas"
    assert (field.min_yield, field.max_yield) == (7, 12)
    assert field.source == "predicted"


def test_load_fluid_config_reads_blacklist_and_hash_orders_fluids(tmp_path: Path) -> None:
    config_file = tmp_path / "UndergroundFluids.cfg"
    fluid_blocks = "\n".join(
        f"""
        fluid{index} {{
            I:Chance={fluid.chance}
            I:MaxAmount={fluid.maximum}
            I:MinAmount={fluid.minimum}
            S:Registry={fluid.registry}
        }}
        """
        for index, fluid in enumerate(_OVERWORLD_FLUIDS)
    )
    config_file.write_text(
        f"""
        undergroundfluid {{
            I:DimBlackList <
                -1
                1
            >
            overworld {{
                S:Dimension=0
                {fluid_blocks}
            }}
        }}
        """,
        encoding="utf-8",
    )

    blacklist, [dimension] = _load_fluid_config(config_file)

    assert blacklist == {-1, 1}
    assert dimension.dimension == "0"
    assert [fluid.registry for fluid in dimension.fluids] == [
        "liquid_light_oil",
        "liquid_medium_oil",
        "oil",
        "gas_natural_gas",
        "liquid_heavy_oil",
    ]


def test_generated_fields_only_include_present_chunks(tmp_path: Path) -> None:
    region_dir = tmp_path / "region"
    region_dir.mkdir()
    header = bytearray(4096)
    # Local chunk (9, 18) in region (-1, 2) => chunk (-23, 82), field (-24, 80).
    index = 9 + 18 * 32
    header[index * 4 : index * 4 + 4] = (2 << 8 | 1).to_bytes(4, "big")
    (region_dir / "r.-1.2.mca").write_bytes(header)

    assert _generated_field_origins(tmp_path) == {(-24, 80)}


def test_find_config_pairs_relocated_backup_with_prism_world_id(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    backup = tmp_path / "backups" / "World"
    backup.mkdir(parents=True)
    minecraft = tmp_path / "PrismLauncher" / "instances" / "GTNH" / ".minecraft"
    vp_world = minecraft / "visualprospecting" / "client" / "server-id" / "World_2f0f03d3"
    vp_world.mkdir(parents=True)
    config = minecraft / "config" / "GregTech" / "UndergroundFluids.cfg"
    config.parent.mkdir(parents=True)
    config.touch()
    monkeypatch.setenv("APPDATA", str(tmp_path))

    assert _find_config(backup, "World_2f0f03d3") == config


def test_prospected_field_overrides_pristine_prediction(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    world = tmp_path / "World"
    world.mkdir()
    (world / "level.dat").touch()
    predicted = BedrockFluidField(
        x=64,
        z=64,
        chunk_x=0,
        chunk_z=0,
        fluid="oil",
        yields=[20] * 64,
        min_yield=20,
        max_yield=20,
        empty=False,
        source="predicted",
    )
    current = predicted.model_copy(
        update={"yields": [10] * 64, "min_yield": 10, "max_yield": 10, "source": "prospected"}
    )
    monkeypatch.setattr(
        bedrock_fluid_service,
        "predict_bedrock_fluids",
        lambda *_args: (True, [predicted]),
    )
    monkeypatch.setattr(bedrock_fluid_service, "_read_world_id", lambda _root: "World_test")
    monkeypatch.setattr(
        bedrock_fluid_service, "_find_dim_files", lambda *_args: [tmp_path / "DIM0.dat"]
    )
    monkeypatch.setattr(bedrock_fluid_service, "_parse_fields", lambda _path: [current])

    response = bedrock_fluid_service.get_bedrock_fluids(str(world))

    assert response.prospected_count == 1
    assert response.predicted_count == 0
    assert response.fields == [current]
