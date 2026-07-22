"""Rotation geometry.

The load-bearing test here is :func:`test_grid_and_interior_compose`: the grid
turn and the in-chunk turn are computed separately, and if they disagree by even
one axis a pasted build comes out sheared rather than turned — which looks like
"rotation is broken" long after the write has happened.
"""

import numpy as np
import pytest

from app.world.chunk_rotate import (
    normalise_turn,
    pack_nibbles,
    rotate_columns,
    rotate_grid,
    rotate_yzx,
    unpack_nibbles,
)


def _yzx(y: int, z: int, x: int) -> int:
    return y * 256 + z * 16 + x


def test_cw90_sends_east_to_south() -> None:
    """The direction convention, pinned to a single block.

    +X is east and +Z is south, so one clockwise turn seen from above must send
    an east-most block to the south edge. Get this backwards and every rotation
    in the app is mirrored.
    """
    a = np.zeros(4096, dtype=np.uint16)
    a[_yzx(0, 0, 15)] = 7  # north-east corner
    out = rotate_yzx(a, 90)
    assert out[_yzx(0, 15, 15)] == 7  # -> south-east corner
    assert out.sum() == 7  # nothing else moved


def test_four_quarter_turns_are_identity() -> None:
    rng = np.random.default_rng(1)
    a = rng.integers(0, 4096, size=4096, dtype=np.uint16)
    out = a
    for _ in range(4):
        out = rotate_yzx(out, 90)
    assert np.array_equal(out, a)


@pytest.mark.parametrize("turn", [90, 180, 270])
def test_rotation_preserves_contents_and_layers(turn: int) -> None:
    """A turn permutes blocks within their own y layer and loses none."""
    rng = np.random.default_rng(2)
    a = rng.integers(0, 4096, size=4096, dtype=np.uint16)
    out = rotate_yzx(a, turn)
    assert sorted(out.tolist()) == sorted(a.tolist())
    for y in range(16):
        lo, hi = y * 256, (y + 1) * 256
        assert sorted(out[lo:hi].tolist()) == sorted(a[lo:hi].tolist())


def test_180_is_two_90s() -> None:
    rng = np.random.default_rng(3)
    a = rng.integers(0, 4096, size=4096, dtype=np.uint16)
    assert np.array_equal(rotate_yzx(a, 180), rotate_yzx(rotate_yzx(a, 90), 90))


def test_270_undoes_90() -> None:
    rng = np.random.default_rng(4)
    a = rng.integers(0, 4096, size=4096, dtype=np.uint16)
    assert np.array_equal(rotate_yzx(rotate_yzx(a, 90), 270), a)


@pytest.mark.parametrize("turn", [0, 90, 180, 270])
def test_grid_and_interior_compose(turn: int) -> None:
    """Grid turn ∘ interior turn == one turn of the whole selection.

    Checked against the closed-form rotation of the selection's block box, for
    every block position in a deliberately non-square selection — square ones
    hide axis swaps.
    """
    width, height = 3, 5  # chunks
    cx0, cz0 = -2, 7  # selection corner, deliberately off-origin and negative
    bw, bh = width * 16, height * 16  # block extent

    def expected(gx: int, gz: int) -> tuple[int, int]:
        if turn == 0:
            return gx, gz
        if turn == 90:
            return bh - 1 - gz, gx
        if turn == 180:
            return bw - 1 - gx, bh - 1 - gz
        return gz, bw - 1 - gx

    for i in range(width):
        for j in range(height):
            ci, cj = rotate_grid(cx0 + i, cz0 + j, turn, cx0, cz0, width, height)
            for lx in (0, 1, 15):
                for lz in (0, 9, 15):
                    # Where the interior turn puts this block in its own chunk.
                    a = np.zeros(4096, dtype=np.uint16)
                    a[_yzx(0, lz, lx)] = 1
                    moved = np.flatnonzero(rotate_yzx(a, turn))[0]
                    lx2, lz2 = int(moved % 16), int((moved // 16) % 16)

                    got = (ci * 16 + lx2, cj * 16 + lz2)
                    assert got == expected(i * 16 + lx, j * 16 + lz), (
                        f"turn={turn} chunk=({i},{j}) local=({lx},{lz})"
                    )


def test_column_rotation_matches_section_rotation() -> None:
    """Biomes/height maps must turn the same way as the blocks above them."""
    rng = np.random.default_rng(5)
    cols = rng.integers(0, 255, size=256, dtype=np.uint16)
    for turn in (90, 180, 270):
        section = np.tile(cols, 16).astype(np.uint16)  # same column map on every y
        assert np.array_equal(rotate_columns(cols, turn), rotate_yzx(section, turn)[:256])


def test_nibble_roundtrip() -> None:
    rng = np.random.default_rng(6)
    values = rng.integers(0, 16, size=4096, dtype=np.uint16)
    assert np.array_equal(unpack_nibbles(pack_nibbles(values), 4096), values)


def test_nibble_packing_puts_even_index_low() -> None:
    """The half-byte order, pinned: getting it backwards swaps every pair."""
    values = np.array([0x3, 0xA] + [0] * 4094, dtype=np.uint16)
    assert pack_nibbles(values)[0] == 0xA3


def test_normalise_turn() -> None:
    assert normalise_turn(-90) == 270
    assert normalise_turn(450) == 90
    assert normalise_turn(0) == 0
    with pytest.raises(ValueError):
        normalise_turn(45)
