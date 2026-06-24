import io
import zipfile
from pathlib import Path

from PIL import Image


def average_color(png_bytes: bytes) -> tuple[int, int, int] | None:
    """Return average RGB of non-transparent pixels, or None if fully transparent."""
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        raw = img.tobytes()  # flat RGBA bytes, 4 bytes per pixel
        r_sum = g_sum = b_sum = count = 0
        for i in range(0, len(raw), 4):
            a = raw[i + 3]
            if a > 128:
                r_sum += raw[i]
                g_sum += raw[i + 1]
                b_sum += raw[i + 2]
                count += 1
        if count == 0:
            return None
        return (r_sum // count, g_sum // count, b_sum // count)
    except Exception:
        return None


def scan_jar(jar_path: Path) -> dict[str, tuple[int, int, int]]:
    """
    Scan a JAR for block textures at assets/{domain}/textures/blocks/{name}.png.
    Returns {"{domain}:{name}": (r, g, b)}.
    """
    colors: dict[str, tuple[int, int, int]] = {}
    try:
        with zipfile.ZipFile(jar_path, "r") as zf:
            for entry in zf.namelist():
                parts = entry.split("/")
                if (
                    len(parts) == 5
                    and parts[0] == "assets"
                    and parts[2] == "textures"
                    and parts[3] == "blocks"
                    and parts[4].endswith(".png")
                ):
                    domain = parts[1]
                    name = parts[4][:-4]
                    try:
                        color = average_color(zf.read(entry))
                    except Exception:
                        continue
                    if color:
                        colors[f"{domain}:{name}"] = color
    except Exception:
        pass
    return colors


def collect_texture_colors(minecraft_dir: Path) -> dict[str, tuple[int, int, int]]:
    """Scan mods/ and versions/ for JARs and aggregate block texture average colors."""
    colors: dict[str, tuple[int, int, int]] = {}

    jars: list[Path] = []
    mods_dir = minecraft_dir / "mods"
    if mods_dir.is_dir():
        jars.extend(mods_dir.glob("*.jar"))
    versions_dir = minecraft_dir / "versions"
    if versions_dir.is_dir():
        jars.extend(versions_dir.glob("**/*.jar"))

    for jar in jars:
        colors.update(scan_jar(jar))

    return colors
