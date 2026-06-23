from pathlib import Path


def validate_world_path(path: str) -> tuple[bool, str | None]:
    world = Path(path)

    if not world.exists():
        return False, "Folder does not exist"
    if not world.is_dir():
        return False, "Selected path is not a folder"
    if not (world / "level.dat").exists():
        return False, "Not a valid Minecraft world (missing level.dat)"

    region_dir = world / "region"
    if not region_dir.is_dir() or not any(region_dir.glob("*.mca")):
        return False, "World has no region data"

    return True, None
