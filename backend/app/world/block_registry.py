from pathlib import Path
from typing import Any

import nbtlib


def read_block_id_map(world_path: Path) -> dict[int, str]:
    """
    Read {numeric_id: registry_name} from level.dat's Forge block registry.
    Returns an empty dict for vanilla worlds or if the data is missing.
    """
    level_dat = world_path / "level.dat"
    if not level_dat.exists():
        return {}

    try:
        nbt: Any = nbtlib.load(str(level_dat))
        fml: Any = nbt["Data"].get("FML")
        if fml is None:
            return {}
        registries: Any = fml.get("Registries")
        if registries is None:
            return {}
        block_reg: Any = registries.get("minecraft:blocks")
        if block_reg is None:
            return {}
        ids: Any = block_reg.get("ids")
        if ids is None:
            return {}

        result: dict[int, str] = {}

        # Forge 1.7.x stores ids as a ListTag of CompoundTags [{K: name, V: id}, ...]
        if hasattr(ids, "__iter__") and not hasattr(ids, "items"):
            for entry in ids:
                k = entry.get("K")
                v = entry.get("V")
                if k is not None and v is not None:
                    result[int(v)] = str(k)
        # Some versions store ids as CompoundTag {name: id, ...}
        elif hasattr(ids, "items"):
            for name, nid in ids.items():
                result[int(nid)] = str(name)

        return result
    except Exception:
        return {}
