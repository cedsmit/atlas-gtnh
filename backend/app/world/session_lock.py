"""Detect whether a Minecraft world is currently open (its session.lock held).

Minecraft holds an exclusive lock on ``<world>/session.lock`` while a world is
loaded; writing its region files then corrupts the save. Chunk ops pre-check this
and refuse with a clear message rather than failing mid-write.

Best-effort and platform-specific (msvcrt on Windows, fcntl elsewhere). If we
can't determine the state, we do NOT block — the atomic-write retry + clear error
in region_writer remain the backstop.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _session_lock_path(dim_path: Path) -> Path | None:
    """Locate ``session.lock`` for the world containing *dim_path*.

    *dim_path* is a dimension directory: the world root itself (overworld) or
    ``<world>/DIMx``. The lock always lives in the world root.
    """
    for root in (dim_path, dim_path.parent):
        candidate = root / "session.lock"
        if candidate.is_file():
            return candidate
    return None


def is_world_open(dim_path: str) -> bool:
    """Return True if the world containing *dim_path* appears loaded in Minecraft.

    Tries to acquire session.lock ourselves; failure means Minecraft holds it.
    Returns False when there's no lock file or the platform can't be probed.
    """
    lock = _session_lock_path(Path(dim_path))
    if lock is None:
        return False
    try:
        fd = os.open(lock, os.O_RDWR)
    except OSError:
        return True  # can't even open it for write → held by another process
    try:
        if sys.platform == "win32":
            import msvcrt

            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                return False
            except OSError:
                return True
        else:
            import fcntl

            try:
                fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.lockf(fd, fcntl.LOCK_UN)
                return False
            except OSError:
                return True
    finally:
        os.close(fd)
