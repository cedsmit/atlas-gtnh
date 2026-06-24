import io
import zipfile
from collections import Counter
from pathlib import Path

from PIL import Image


def average_color(png_bytes: bytes) -> tuple[int, int, int] | None:
    """Average RGB of non-transparent pixels."""
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        raw = img.tobytes()
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


def dominant_color(png_bytes: bytes) -> tuple[int, int, int] | None:
    """
    Most visually prominent RGB color in a texture, ignoring transparent and
    very dark pixels (which are typically overlays, glints, or shadow pixels).

    Strategy: quantise to 4-bit buckets per channel, pick the most-populated
    bucket, then average the original pixel values in that bucket.
    """
    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        raw = img.tobytes()

        bucket_count: Counter[tuple[int, int, int]] = Counter()
        bucket_sums: dict[tuple[int, int, int], list[int]] = {}  # [r, g, b, n]

        for i in range(0, len(raw), 4):
            a = raw[i + 3]
            r, g, b = raw[i], raw[i + 1], raw[i + 2]
            # Skip transparent and nearly-black pixels
            if a <= 128 or max(r, g, b) <= 30:
                continue
            key = (r >> 4, g >> 4, b >> 4)
            bucket_count[key] += 1
            if key in bucket_sums:
                s = bucket_sums[key]
                s[0] += r
                s[1] += g
                s[2] += b
                s[3] += 1
            else:
                bucket_sums[key] = [r, g, b, 1]

        if not bucket_count:
            return None

        best = bucket_count.most_common(1)[0][0]
        s = bucket_sums[best]
        n = s[3]
        return (s[0] // n, s[1] // n, s[2] // n)
    except Exception:
        return None


# Return type: registry_name → (avg_rgb, dominant_rgb | None)
JarColors = dict[str, tuple[tuple[int, int, int], tuple[int, int, int] | None]]


def scan_jar(jar_path: Path) -> JarColors:
    """
    Scan a JAR for block textures at assets/{domain}/textures/blocks/{name}.png.

    Returns a mapping of registry name → (avg_color, dominant_color).
    Both colors may differ significantly for GregTech and other modded blocks.
    """
    colors: JarColors = {}
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
                        png = zf.read(entry)
                    except Exception:
                        continue
                    avg = average_color(png)
                    if avg is None:
                        continue
                    dom = dominant_color(png)
                    colors[f"{domain}:{name}"] = (avg, dom)
    except Exception:
        pass
    return colors


def collect_texture_colors(minecraft_dir: Path) -> dict[str, tuple[int, int, int]]:
    """Scan mods/ and versions/ JARs and return avg block texture colors (no cache)."""
    colors: dict[str, tuple[int, int, int]] = {}

    jars: list[Path] = []
    mods_dir = minecraft_dir / "mods"
    if mods_dir.is_dir():
        jars.extend(mods_dir.glob("**/*.jar"))
    versions_dir = minecraft_dir / "versions"
    if versions_dir.is_dir():
        jars.extend(versions_dir.glob("**/*.jar"))

    for jar in jars:
        for name, (avg, _) in scan_jar(jar).items():
            colors[name] = avg

    return colors
