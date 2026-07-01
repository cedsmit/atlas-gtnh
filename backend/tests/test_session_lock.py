import os
from pathlib import Path

import pytest

from app.world.session_lock import is_world_open

_SNOWMAN = b"\xe2\x98\x83"  # what Minecraft writes into session.lock


def test_no_lock_file(tmp_path: Path) -> None:
    (tmp_path / "region").mkdir()
    assert is_world_open(str(tmp_path)) is False


def test_unlocked_session_lock(tmp_path: Path) -> None:
    (tmp_path / "session.lock").write_bytes(_SNOWMAN)
    assert is_world_open(str(tmp_path)) is False


def test_dim_path_uses_world_root_lock(tmp_path: Path) -> None:
    # A DIMx dimension dir: session.lock lives in the world root (its parent).
    (tmp_path / "session.lock").write_bytes(_SNOWMAN)
    dim = tmp_path / "DIM-1"
    dim.mkdir()
    assert is_world_open(str(dim)) is False


@pytest.mark.skipif(os.name != "nt", reason="byte-range locks are per-handle only on Windows")
def test_held_lock_detected(tmp_path: Path) -> None:
    import msvcrt

    lock = tmp_path / "session.lock"
    lock.write_bytes(_SNOWMAN)
    fd = os.open(lock, os.O_RDWR)
    try:
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        assert is_world_open(str(tmp_path)) is True
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
    finally:
        os.close(fd)
