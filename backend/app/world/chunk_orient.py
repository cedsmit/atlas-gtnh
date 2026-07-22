"""Turn a block's *orientation* to match a rotated paste.

Moving a block is exact (see ``chunk_rotate``); turning what it faces is not,
and this module is where the honesty about that lives.

Two sources of orientation, handled differently:

**Vanilla metadata** — a fixed, documented encoding per block, keyed on numeric
id. That is safe to hard-code because 1.7.10 reserves ids below 256 for vanilla;
mods are assigned 256 and up, so a rule can never collide with a modded block.
Only families whose encoding is unambiguous are listed. Anything absent is left
alone rather than guessed, because a wrong metadata value does not fail loudly —
it produces a stair facing into a wall, or a rail that no longer connects.

**Tile-entity NBT** — where GregTech machines and pipes keep their facing. There
is no registry of these: every mod invents its own key names *and* encodings, so
this is a best-effort pass over keys that look directional and hold a value in
ForgeDirection range. It is deliberately conservative, and every key it changes
and every one it declines is counted, so the caller can tell the user what was
actually touched. See :class:`OrientReport`.

Directions follow ``chunk_rotate``: a clockwise turn seen from above sends east
to south.
"""

from __future__ import annotations

from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Any

# ── ForgeDirection ordinals, the lingua franca of 1.7.10 mod facing ──────────
DOWN, UP, NORTH, SOUTH, WEST, EAST = range(6)

#: One clockwise quarter turn, as a permutation of ForgeDirection.
#: north -> east -> south -> west -> north; up/down are on the turn axis.
_FORGE_CW = {DOWN: DOWN, UP: UP, NORTH: EAST, EAST: SOUTH, SOUTH: WEST, WEST: NORTH}

#: Vanilla "BlockDirectional" nibble: 0 south, 1 west, 2 north, 3 east.
_D4_CW = {0: 1, 1: 2, 2: 3, 3: 0}

#: Stairs: 0 east, 1 west, 2 south, 3 north (bit 4 = upside down, untouched).
_STAIRS_CW = {0: 2, 1: 3, 2: 1, 3: 0}

#: Torches and buttons: 1 east, 2 west, 3 south, 4 north (5 = standing).
_TORCH_CW = {1: 3, 2: 4, 3: 2, 4: 1}

#: Rails: straights, ascents, then the four corner pieces.
_RAIL_CW = {0: 1, 1: 0, 2: 5, 3: 4, 4: 2, 5: 3, 6: 7, 7: 8, 8: 9, 9: 6}

#: Vine faces, as a bitmask: 1 south, 2 west, 4 north, 8 east.
_VINE_CW = {1: 2, 2: 4, 4: 8, 8: 1}


def _turns(turn: int) -> int:
    return (turn // 90) % 4


def _apply(table: dict[int, int], value: int, turns: int) -> int:
    for _ in range(turns):
        value = table.get(value, value)
    return value


def rotate_forge_direction(value: int, turn: int) -> int:
    """Turn a ForgeDirection ordinal. Up/down come back unchanged."""
    return _apply(_FORGE_CW, value, _turns(turn))


def rotate_forge_mask(mask: int, turn: int) -> int:
    """Turn a bitmask whose bit *i* means ForgeDirection *i* (GT pipe sides)."""
    out = 0
    for bit in range(6):
        if mask & (1 << bit):
            out |= 1 << rotate_forge_direction(bit, turn)
    return out | (mask & ~0x3F)  # keep any high bits we do not understand


# ── Vanilla metadata ────────────────────────────────────────────────────────
# Families, then the ids that use each. Ids are the fixed vanilla ones.


def _meta_stairs(meta: int, turns: int) -> int:
    return (meta & 0x4) | _apply(_STAIRS_CW, meta & 0x3, turns)


def _meta_d4(meta: int, turns: int) -> int:
    """Low two bits are the direction; higher bits (powered, head, open) ride along."""
    return (meta & ~0x3) | _apply(_D4_CW, meta & 0x3, turns)


def _meta_forge(meta: int, turns: int) -> int:
    """Blocks storing a ForgeDirection in the low three bits — chests, furnaces,
    ladders, wall signs, hoppers, pistons, droppers."""
    low = meta & 0x7
    return (meta & ~0x7) | (_apply(_FORGE_CW, low, turns) if low < 6 else low)


def _meta_torch(meta: int, turns: int) -> int:
    return _apply(_TORCH_CW, meta, turns) if 1 <= meta <= 4 else meta


def _meta_log(meta: int, turns: int) -> int:
    """Bits 2-3 are the axis: 0 upright, 4 along X, 8 along Z, 12 all-bark."""
    axis = meta & 0xC
    if turns % 2 and axis in (0x4, 0x8):
        axis ^= 0xC  # 4 <-> 8
    return (meta & ~0xC) | axis


def _meta_rail(meta: int, turns: int) -> int:
    return _apply(_RAIL_CW, meta, turns)


def _meta_rail_powered(meta: int, turns: int) -> int:
    """Powered rails cannot curve, so bit 3 is the power flag, not a corner."""
    return (meta & 0x8) | _apply(_RAIL_CW, meta & 0x7, turns)


def _meta_vine(meta: int, turns: int) -> int:
    out = 0
    for bit in (1, 2, 4, 8):
        if meta & bit:
            out |= _apply(_VINE_CW, bit, turns)
    return out


def _meta_sign16(meta: int, turns: int) -> int:
    """Standing signs use 16 steps around the compass; a quarter turn is four."""
    return (meta + 4 * turns) % 16


#: id -> function(meta, turns) -> meta. Vanilla ids only (all below 256).
_META_RULES = {
    **{i: _meta_stairs for i in (53, 67, 108, 109, 114, 128, 134, 135, 136, 156, 163, 164, 180)},
    **{i: _meta_forge for i in (23, 54, 61, 62, 65, 68, 130, 146, 154, 158, 29, 33, 34)},
    **{i: _meta_torch for i in (50, 75, 76, 77, 143)},
    **{i: _meta_log for i in (17, 162)},
    **{
        i: _meta_d4 for i in (26, 86, 91, 93, 94, 107, 120, 127, 149, 150, 183, 184, 185, 186, 187)
    },  # fmt: skip
    **{i: _meta_rail_powered for i in (27, 28, 157)},
    66: _meta_rail,
    106: _meta_vine,
    63: _meta_sign16,
}

#: Tile-entity keys holding a 0-15 compass step rather than a direction.
_TE_SIGN16_KEYS = ("Rot",)

#: Substrings that mark a tile-entity key as probably holding a facing.
_TE_DIR_HINTS = ("facing", "direction", "orientation", "rotation")

#: Substrings that mark a key as a set of connected sides.
_TE_MASK_HINTS = ("connection", "connections", "connected", "sides")


@dataclass
class OrientReport:
    """What the orientation pass actually did, so the user is not guessing.

    ``guessed`` is the honest part: those are tile-entity keys matched by name,
    not by a rule anyone verified, and they are the ones to check in-game.
    """

    blocks_turned: int = 0
    blocks_skipped: dict[int, int] = field(default_factory=dict)
    guessed: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "blocks_turned": self.blocks_turned,
            "blocks_skipped": dict(sorted(self.blocks_skipped.items())),
            "guessed_keys": dict(sorted(self.guessed.items())),
        }


def meta_lut(block_id: int, turn: int) -> list[int] | None:
    """The block's whole metadata mapping as a 16-entry table, or None if we have
    no rule for it.

    A table lets a section be turned with one vectorised lookup per distinct
    block id, instead of a Python call per block — the difference between a
    paste that feels instant and one that does not.
    """
    turns = _turns(turn)
    rule = _META_RULES.get(block_id)
    if rule is None or not turns:
        return None
    return [rule(meta, turns) for meta in range(16)]


def has_meta_rule(block_id: int) -> bool:
    return block_id in _META_RULES


def rotate_block_meta(block_id: int, meta: int, turn: int, report: OrientReport) -> int:
    """Turn one block's metadata, or return it unchanged and record the miss."""
    turns = _turns(turn)
    if not turns:
        return meta
    rule = _META_RULES.get(block_id)
    if rule is None:
        # Modded blocks (id >= 256) orient via their tile entity far more often
        # than via metadata, so counting every one of them as a miss would bury
        # the real misses. Only vanilla ids are reported here.
        if 0 < block_id < 256 and meta:
            report.blocks_skipped[block_id] = report.blocks_skipped.get(block_id, 0) + 1
        return meta
    out = rule(meta, turns)
    if out != meta:
        report.blocks_turned += 1
    return out


def rotate_tile_entity(te: MutableMapping[str, Any], turn: int, report: OrientReport) -> None:
    """Best-effort: turn any value in *te* that looks like a facing.

    Only touches keys whose name suggests a direction and whose value is already
    in range for the encoding being assumed — a mod storing something else under
    a similar name is left alone. This is a heuristic, and the report says so.
    """
    turns = _turns(turn)
    if not turns:
        return
    for key in list(te.keys()):
        value = te[key]
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue  # compounds, strings, lists — not a facing
        low = key.lower()

        if key in _TE_SIGN16_KEYS and 0 <= number <= 15:
            te[key] = type(value)((number + 4 * turns) % 16)
            report.guessed[key] = report.guessed.get(key, 0) + 1
        elif any(h in low for h in _TE_MASK_HINTS) and 0 <= number <= 0x3F:
            turned = rotate_forge_mask(number, turn)
            if turned != number:
                te[key] = type(value)(turned)
            report.guessed[key] = report.guessed.get(key, 0) + 1
        elif any(h in low for h in _TE_DIR_HINTS) and 0 <= number <= 5:
            turned = rotate_forge_direction(number, turn)
            if turned != number:
                te[key] = type(value)(turned)
            report.guessed[key] = report.guessed.get(key, 0) + 1
