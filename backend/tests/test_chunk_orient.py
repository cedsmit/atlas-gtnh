"""Block orientation under rotation.

Every rule here is checked for the property that actually matters: four quarter
turns must return the original value. A mapping that is merely plausible but not
a permutation fails that, which is how a subtly wrong table gets caught before
it is written into somebody's save.
"""

import pytest
from nbtlib import Byte, Compound, Int, String

from app.world.chunk_orient import (
    EAST,
    NORTH,
    SOUTH,
    UP,
    WEST,
    OrientReport,
    rotate_block_meta,
    rotate_forge_direction,
    rotate_forge_mask,
    rotate_tile_entity,
)

STAIRS, TORCH, LOG, CHEST, RAIL, SIGN = 53, 50, 17, 54, 66, 63


def test_clockwise_sends_east_to_south() -> None:
    """The same convention the geometry uses — they must agree or a rotated
    machine faces the wrong way while sitting in the right place."""
    assert rotate_forge_direction(EAST, 90) == SOUTH
    assert rotate_forge_direction(SOUTH, 90) == WEST
    assert rotate_forge_direction(WEST, 90) == NORTH
    assert rotate_forge_direction(NORTH, 90) == EAST


def test_vertical_facing_is_untouched() -> None:
    assert rotate_forge_direction(UP, 90) == UP
    assert rotate_forge_direction(UP, 180) == UP


@pytest.mark.parametrize("value", range(6))
def test_forge_direction_is_a_permutation(value: int) -> None:
    out = value
    for _ in range(4):
        out = rotate_forge_direction(out, 90)
    assert out == value


def test_forge_mask_turns_every_side() -> None:
    """A pipe connected north+east is connected east+south after a turn."""
    mask = (1 << NORTH) | (1 << EAST)
    assert rotate_forge_mask(mask, 90) == (1 << EAST) | (1 << SOUTH)


def test_forge_mask_keeps_vertical_connections() -> None:
    mask = (1 << UP) | (1 << NORTH)
    assert rotate_forge_mask(mask, 180) == (1 << UP) | (1 << SOUTH)


@pytest.mark.parametrize(
    "block_id,meta",
    [
        (STAIRS, 0),
        (STAIRS, 3),
        (STAIRS, 4 | 2),  # upside-down keeps its bit
        (TORCH, 1),
        (TORCH, 4),
        (CHEST, NORTH),
        (CHEST, EAST),
        (LOG, 4),
        (LOG, 8),
        (LOG, 0),  # upright is unaffected
        (RAIL, 0),
        (RAIL, 6),
        (SIGN, 0),
        (SIGN, 7),
    ],
)
def test_metadata_rules_are_permutations(block_id: int, meta: int) -> None:
    report = OrientReport()
    out = meta
    for _ in range(4):
        out = rotate_block_meta(block_id, out, 90, report)
    assert out == meta


def test_stairs_turn_and_keep_upside_down() -> None:
    r = OrientReport()
    assert rotate_block_meta(STAIRS, 0, 90, r) == 2  # east -> south
    assert rotate_block_meta(STAIRS, 4, 90, r) == 6  # still upside down


def test_log_axis_swaps_only_on_quarter_turns() -> None:
    r = OrientReport()
    assert rotate_block_meta(LOG, 4, 90, r) == 8  # X -> Z
    assert rotate_block_meta(LOG, 4, 180, r) == 4  # half turn keeps the axis
    assert rotate_block_meta(LOG, 12, 90, r) == 12  # all-bark has no axis


def test_unknown_vanilla_block_is_left_alone_and_reported() -> None:
    r = OrientReport()
    assert rotate_block_meta(69, 5, 90, r) == 5  # lever: no verified rule
    assert r.blocks_skipped == {69: 1}
    assert r.blocks_turned == 0


def test_modded_ids_are_not_counted_as_misses() -> None:
    """Modded blocks orient through their tile entity, so counting each one as a
    skipped block would bury the vanilla misses that are worth acting on."""
    r = OrientReport()
    rotate_block_meta(3000, 7, 90, r)
    assert r.blocks_skipped == {}


def test_tile_entity_facing_is_turned_and_flagged_as_a_guess() -> None:
    te = Compound({"id": String("GT_TileEntity"), "mFacing": Byte(EAST)})
    r = OrientReport()
    rotate_tile_entity(te, 90, r)
    assert int(te["mFacing"]) == SOUTH
    assert r.guessed == {"mFacing": 1}  # reported: nobody verified this key


def test_tile_entity_connection_mask_is_turned() -> None:
    te = Compound({"mConnections": Byte((1 << NORTH) | (1 << EAST))})
    r = OrientReport()
    rotate_tile_entity(te, 90, r)
    assert int(te["mConnections"]) == (1 << EAST) | (1 << SOUTH)


def test_out_of_range_values_are_left_alone() -> None:
    """A mod storing something else under a directional-sounding name."""
    te = Compound({"rotationSpeed": Int(240), "id": String("x")})
    r = OrientReport()
    rotate_tile_entity(te, 90, r)
    assert int(te["rotationSpeed"]) == 240
    assert r.guessed == {}


def test_non_numeric_values_are_ignored() -> None:
    te = Compound({"facingName": String("north")})
    r = OrientReport()
    rotate_tile_entity(te, 90, r)
    assert str(te["facingName"]) == "north"


def test_skull_rotation_uses_sixteen_steps() -> None:
    te = Compound({"Rot": Byte(0)})
    r = OrientReport()
    rotate_tile_entity(te, 90, r)
    assert int(te["Rot"]) == 4


def test_zero_turn_changes_nothing() -> None:
    te = Compound({"mFacing": Byte(EAST)})
    r = OrientReport()
    rotate_tile_entity(te, 0, r)
    assert int(te["mFacing"]) == EAST
    assert r.guessed == {}
