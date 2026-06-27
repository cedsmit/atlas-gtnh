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

        # Older Forge 1.7.10 format: ItemData lists both registries.  Each entry's
        # name carries a leading control byte — \x01 marks a block registration,
        # \x02 an item.  A block always has a \x01 entry (and, when it also has an
        # ItemBlock, a second \x02 entry at the same id).  Selecting the \x01
        # entries yields exactly the block set and — crucially for GTNH — keeps
        # extended block IDs above the vanilla 4096 ceiling (e.g. id 10826).
        # Note: we iterate raw entries rather than _parse_id_list() because that
        # dedupes by id and would discard the \x01/\x02 distinction.
        item_data: Any = fml.get("ItemData")
        if item_data is not None:
            result: dict[int, str] = {}
            for entry in item_data:
                name = entry.get("K")
                nid = entry.get("V")
                if name is None or nid is None:
                    continue
                s = str(name)
                if s[:1] == "\x01":
                    result[int(nid)] = s[1:]
            if result:
                return result

            # Fallback for layouts that carry no \x01 block markers: strip any
            # control prefix and keep the vanilla block-id range.
            for entry in item_data:
                name = entry.get("K")
                nid = entry.get("V")
                if name is None or nid is None:
                    continue
                s = str(name)
                cleaned = s[1:] if s[:1] in ("\x00", "\x01", "\x02") else s
                if int(nid) < 4096:
                    result[int(nid)] = cleaned
            return result

        return {}
    except Exception:
        return {}
