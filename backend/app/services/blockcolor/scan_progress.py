"""Live mod-JAR scan progress for the loading screen.

``_load_asset_db`` updates a per-world :class:`ScanProgress` as it walks the JAR
list, so the frontend can poll ``/worlds/scan-progress`` and show which mod is
currently being scanned. State is process-global and lock-guarded; each stored
value is an immutable snapshot, so reads are always internally consistent.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class ScanProgress:
    total: int = 0  # JARs to scan this run
    scanned: int = 0  # JARs completed so far
    current: str = ""  # name of the JAR being scanned now ("" when idle)
    done: bool = True  # True before any scan starts and once the last finishes


class ScanProgressTracker:
    """Thread-safe per-world scan progress: written by the scan, read by the API."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_world: dict[str, ScanProgress] = {}

    def start(self, world_path: str, total: int) -> None:
        with self._lock:
            self._by_world[world_path] = ScanProgress(total=total, done=False)

    def advance(self, world_path: str, current: str, scanned: int) -> None:
        with self._lock:
            prev = self._by_world.get(world_path)
            if prev is not None:
                self._by_world[world_path] = replace(prev, current=current, scanned=scanned)

    def finish(self, world_path: str) -> None:
        with self._lock:
            prev = self._by_world.get(world_path)
            total = prev.total if prev is not None else 0
            self._by_world[world_path] = ScanProgress(
                total=total, scanned=total, current="", done=True
            )

    def get(self, world_path: str) -> ScanProgress:
        with self._lock:
            return self._by_world.get(world_path, ScanProgress())


_tracker = ScanProgressTracker()


def get_scan_progress_tracker() -> ScanProgressTracker:
    """Return the process-shared scan-progress tracker."""
    return _tracker
