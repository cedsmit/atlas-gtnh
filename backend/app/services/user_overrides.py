"""Authored render-rule overrides — Stage 2.3 (self-learning registry).

The shipped app has no debug tools, so end users can't create overrides — this is a
**maintainer authoring tool**. The debug panel's "Save" writes an accepted render rule
straight into the SHIPPED render-rules file ``frontend/src/features/blocks/render-rules/
authored.json``, which Vite bundles via its ``render-rules/*.json`` glob — so a fix made
in dev reaches *every* end user on the next build, with no per-user file and no manual
copy. The frontend also fetches it live (GET) so a Save re-renders immediately in dev.

The file is a ``RegistryJson`` the frontend loads verbatim::

    {"format": 1, "source": "authored", "blocks": {"<modid:name>": {<definition>}}}

Dev-only (it writes into the repo tree); the target is overridable via
``ATLAS_AUTHORED_RULES_PATH``.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any


def _default_path() -> Path:
    env = os.environ.get("ATLAS_AUTHORED_RULES_PATH", "").strip()
    if env:
        return Path(env)
    # backend/app/services/user_overrides.py → parents[3] is the repo root.
    return (
        Path(__file__).resolve().parents[3]
        / "frontend"
        / "src"
        / "features"
        / "blocks"
        / "render-rules"
        / "authored.json"
    )


_PATH = _default_path()
_lock = threading.Lock()  # serialise read-modify-write

# Definition keys accepted from the client — mirrors the frontend BlockRenderDefinition.
# Anything else is dropped so a caller can't smuggle arbitrary fields into the file.
_ALLOWED_KEYS = frozenset(
    {
        "category",
        "tint",
        "alphaMode",
        "mapRenderMode",
        "mapVisibility",
        "mapOpacity",
        "mapColor",
        "blockTags",
        "renderHeight",
        "overlayPriority",
        "textureAlias",
        "textureTint",
        "textureTintColors",
        "preserveAlpha",
    }
)


def _empty() -> dict[str, Any]:
    return {"format": 1, "source": "authored", "blocks": {}}


def load_overrides() -> dict[str, Any]:
    """The stored overrides as a ``RegistryJson``; an empty skeleton if none/corrupt."""
    if not _PATH.exists():
        return _empty()
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _empty()
    if not isinstance(data, dict) or not isinstance(data.get("blocks"), dict):
        return _empty()
    data.setdefault("format", 1)
    data.setdefault("source", "user-overrides")
    return data


def _sanitize(definition: dict[str, Any]) -> dict[str, Any]:
    """Keep only known definition keys (drops unrecognised fields)."""
    return {k: v for k, v in definition.items() if k in _ALLOWED_KEYS}


def _persist(data: dict[str, Any]) -> None:
    """Write the file — or delete it when no overrides remain, so an empty
    ``authored.json`` isn't left lingering in the render-rules tree."""
    if data["blocks"]:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    elif _PATH.exists():
        _PATH.unlink()


def upsert_override(name: str, definition: dict[str, Any]) -> dict[str, Any]:
    """Add or replace one block's override; returns the full overrides doc."""
    clean = _sanitize(definition)
    with _lock:
        data = load_overrides()
        data["blocks"][name] = clean
        _persist(data)
        return data


def remove_override(name: str) -> dict[str, Any]:
    """Remove one block's override; returns the full overrides doc. Deletes the
    file when that was the last override."""
    with _lock:
        data = load_overrides()
        data["blocks"].pop(name, None)
        _persist(data)
        return data
