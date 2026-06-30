"""Shared container for the JSON and texture assets scanned from mod JARs.

Its own module because it's used independently across the colour/texture
subsystem (resolver, service, diagnostics) rather than belonging to any one of
them.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AssetDatabase:
    """All JSON and texture assets loaded from mod JARs."""

    # "domain:blockname"  → parsed blockstate JSON
    blockstates: dict[str, Any] = field(default_factory=dict)
    # "domain:block/path" → parsed model JSON
    models: dict[str, Any] = field(default_factory=dict)
    # "domain:texname"    → (r, g, b)
    texture_colors: dict[str, tuple[int, int, int]] = field(default_factory=dict)
