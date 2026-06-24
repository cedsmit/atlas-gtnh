from pathlib import Path
from typing import Any

import nbtlib


def _parse_id_list(ids: Any) -> dict[int, str]:
    """Parse a Forge id list (either ListTag of {K,V} compounds or CompoundTag)."""
    result: dict[int, str] = {}
    if hasattr(ids, "__iter__") and not hasattr(ids, "items"):
        for entry in ids:
            k = entry.get("K")
            v = entry.get("V")
            if k is not None and v is not None:
                result[int(v)] = str(k)
    elif hasattr(ids, "items"):
        for name, nid in ids.items():
            result[int(nid)] = str(name)
    return result


def read_block_id_map(world_path: Path) -> dict[int, str]:
    """
    Read {numeric_id: registry_name} from level.dat's Forge block registry.

    Supports two Forge layouts:
    - Newer: FML.Registries.minecraft:blocks.ids  (FML under Data or at root)
    - Older 1.7.10: FML.ItemData  (FML at root; mixes blocks + items, filter < 4096)
    """
    level_dat = world_path / "level.dat"
    if not level_dat.exists():
        return {}

    try:
        nbt: Any = nbtlib.load(str(level_dat))

        # FML lives at root in older Forge 1.7.10, under Data in newer builds
        fml: Any = nbt.get("FML") or nbt["Data"].get("FML")
        if fml is None:
            return {}

        # Newer format: Registries → minecraft:blocks → ids
        registries: Any = fml.get("Registries")
        if registries is not None:
            block_reg: Any = registries.get("minecraft:blocks")
            if block_reg is not None:
                ids: Any = block_reg.get("ids")
                if ids is not None:
                    return _parse_id_list(ids)

        # Older Forge 1.7.10 format: ItemData mixes blocks and items.
        # The prefix byte is \x01 or \x02 depending on how the mod registered
        # the block — strip either prefix and include all IDs < 4096 (block range).
        item_data: Any = fml.get("ItemData")
        if item_data is not None:
            all_entries = _parse_id_list(item_data)
            result: dict[int, str] = {}
            for nid, name in all_entries.items():
                if name.startswith(("\x01", "\x02")):
                    cleaned = name[1:]
                elif name.startswith("\x00"):
                    cleaned = name[1:]
                else:
                    cleaned = name
                if nid < 4096:
                    result[nid] = cleaned
            return result

        return {}
    except Exception:
        return {}
