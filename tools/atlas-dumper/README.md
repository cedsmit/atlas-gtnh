# Atlas Dumper

A small Forge 1.7.10 client-side mod that exports (1) the exact block→texture
mapping, (2) each biome's real grass/foliage colour that Minecraft uses, and
(3) the GregTech ore-vein registry (names + material colours) — enabling Atlas
GTNH to resolve textures, biome tints and ore-vein labels without heuristics.

## What it does

**Icons** — after the game stitches the blocks texture atlas (all
`registerBlockIcons()` calls have completed), it iterates every registered block
and calls `block.getIcon(side, meta)` via reflection for all 16 metadata values
and 6 sides. The icon names from `IIcon.getIconName()` — the same strings
Minecraft's own renderer uses — are written to:

```
.minecraft/config/atlas/icon_dump.json
```

**Biome colours** — on the first client tick after a world is loaded (so the
grass/foliage colormaps are available), it iterates `BiomeGenBase.getBiomeGenArray()`
and reads each biome's `getBiomeGrassColor()` / `getBiomeFoliageColor()` (colormap
lookups plus any mod override, e.g. Biomes O' Plenty). These are written to:

```
.minecraft/config/atlas/biome_dump.json
```

Atlas serves this so grass/foliage tint from ground truth instead of an
approximate temperature/rainfall table (which is wrong for most modded biomes).

**Ore veins** — on the first client tick after a world is loaded (so GregTech's
`OreMixes` / `Materials` registry and its ore-block icons are fully baked), it
reflects over `gregtech.api.enums.OreMixes` and, for each mix, records the
Visual-Prospecting palette key (`ore.mix.X`), its localized name, the
representative material's RGBA tint, its enabled dimensions, and a best-effort
ore-texture key. These are written to:

```
.minecraft/config/atlas/ore_vein_dump.json
```

Atlas overlays the veins Visual Prospecting caches for a world using these real
names + material colours instead of a hashed placeholder palette.

All three dumps use the same reflection approach (MCP name → SRG name fallback,
GregTech classes by their real names) so the mod compiles against only the Forge
universal JAR.

## Installation

Run **`build.bat`** (one double-click): it compiles, packages
`atlas-dumper-<version>.jar`, and offers to install it into a detected GTNH
instance — pruning any older `atlas*dumper*.jar` there first (this also clears
out jars from before the rename), so exactly one copy remains. Then load a world
once (see [Running](#running)). The jar isn't checked in; build it locally.

## Building from source

The mod compiles with **any JDK 8+** against the Forge universal JAR and the
vanilla minecraft JAR (both already downloaded by your launcher). No ForgeGradle
or Gradle wrapper required.

### Find your JARs

- **Prism Launcher** (default paths):
  ```
  %APPDATA%\PrismLauncher\libraries\net\minecraftforge\forge\1.7.10-10.13.4.1614-1.7.10\forge-1.7.10-10.13.4.1614-1.7.10-universal.jar
  %APPDATA%\PrismLauncher\libraries\com\mojang\minecraft\1.7.10\minecraft-1.7.10-client.jar
  ```
- **MultiMC** uses the same layout under `%APPDATA%\MultiMC\libraries\`.

### Compile

> **Replace both `path\to\...` placeholders with your real JAR paths.** Leaving
> them literal is the usual cause of a wall of "cannot find symbol" errors —
> `javac` can't find a single Forge/Minecraft class, so every reference fails.

```cmd
javac --release 8 ^
  -cp "path\to\forge-universal.jar;path\to\minecraft-client.jar" ^
  -d out ^
  src\main\java\com\atlasgtnh\icondumper\AtlasDumper.java
```

A worked example with resolved Prism paths (yours will differ by Forge build):

```cmd
javac --release 8 ^
  -cp "%APPDATA%\PrismLauncher\libraries\net\minecraftforge\forge\1.7.10-10.13.4.1614-1.7.10\forge-1.7.10-10.13.4.1614-1.7.10-universal.jar;%APPDATA%\PrismLauncher\libraries\com\mojang\minecraft\1.7.10\minecraft-1.7.10-client.jar" ^
  -d out ^
  src\main\java\com\atlasgtnh\icondumper\AtlasDumper.java
```

On JDK 20+ you'll see three `source/target value 8 is obsolete` warnings —
harmless; the build still succeeds and produces Java 8 bytecode. (Any JDK 8–25
works; the mod only needs a Java 8 classfile.)

### Package

```cmd
jar cf atlas-dumper-1.4.0.jar -C out .
```

The compiled `out\` must contain `mcmod.info` and `pack.mcmeta` too, not just the
`.class` — Gradle normally copies them from `src\main\resources`. When building
by hand, copy both into `out\` first and substitute the `${version}`/`${mcversion}`
tokens in `mcmod.info` (→ `1.4.0` / `1.7.10`), or the mod loads without metadata.
(`build.bat` does all of this for you.)

### Notes on vanilla JAR

The vanilla JAR is only needed **at compile time** so javac can resolve the
class hierarchy of Forge's `FMLControlledNamespacedRegistry`. Our compiled
bytecode references only Forge classes; all vanilla Minecraft method calls go
through `java.lang.reflect.Method` by MCP name, which are available at runtime
because Forge's class loader deobfuscates them.

## Running

Launch the GTNH client normally.

- **Icons** dump after the texture atlas stitches — by the time the **main menu**
  appears, `icon_dump.json` is already written. No world needed.
- **Biome colours** and **ore veins** dump on the first client tick **after you
  load a world** (single-player or a server). Biome colormaps aren't available,
  and GregTech's ore/material registry isn't fully baked, until then — so the
  **main menu is not enough**. Load any world in the pack once and
  `biome_dump.json` + `ore_vein_dump.json` appear. Any world works: the ore-vein
  dump reads GregTech's static registry, not your save's data.

Watch the game log for:
```
[AtlasDumper] Done — 4012/4095 blocks (61 no-icon, 22 unnamed), 289 mods, 83 errors → .minecraft/config/atlas/icon_dump.json
[AtlasDumper] Biome dump done — 91 biomes, 0 errors → .minecraft/config/atlas/biome_dump.json
[AtlasDumper] Ore-vein dump done — 122 veins (N with texture), 0 errors → .minecraft/config/atlas/ore_vein_dump.json
```

## Dump summary fields

The `summary` block records coverage so a world↔dump mismatch is visible
instead of showing up as silent "no mapping" blocks on the map:

| field | meaning |
|-------|---------|
| `total_blocks` | blocks with a resolved registry name |
| `blocks_with_icons` | blocks that produced at least one icon (the dumped set) |
| `blocks_without_icons` | named blocks with no icon (TESR-rendered, technical) |
| `skipped_no_name` | registry entries with no resolvable name |
| `mod_count` | number of loaded mods |
| `no_icon_blocks` | full list of `blocks_without_icons` names (registry entries whose `getIcon(side, meta)` yielded nothing — resolve these via render rules/legacy) |

A top-level **`mods`** array lists every loaded mod as `modid@version`. Atlas
can diff this against a world's `FML.ModList` to tell you exactly which mods are
absent from the dump — the usual reason a block falls back to a flat color is
that the dump was generated from a **different pack build** than the world.

> **Generate the dump from the same instance whose worlds you view.** If the
> world uses mods the dump's client didn't load, those blocks have no mapping.

## Giving the dump to Atlas

Atlas resolves the dump in this order:

1. `ATLAS_ICON_DUMP_PATH` environment variable (full path to the file)
2. `{mc_dir}/config/atlas/icon_dump.json` — auto-discovered when the world sits
   inside the GTNH instance that wrote it (the normal single-player case)
3. `~/.atlas_gtnh/icon_dump.json` — a global drop-in that works for **any** map,
   including **server worlds** copied out on their own with no instance around
   them. Generate the dump from a client running the same modpack as the server,
   then drop it here.

The dump must come from a **client** with the same mods as the world (a server
can't generate it — no textures). The dump-mismatch banner flags version gaps.

You can also import it via the Atlas API:
```
POST /worlds/load-dump
Content-Type: application/json
{ "path": "E:\\GT - New Horizons 2.8\\config\\atlas\\icon_dump.json" }
```

## Re-running

Re-run after any mod update that adds or changes block textures. The dump
takes approximately 1-2 seconds to generate.

## Blocks not in the dump

Blocks that use a Tile Entity Special Renderer (TESR) have no `IIcon` and
will not appear in the dump. These blocks render via raw OpenGL calls:
- Railcraft standard iron track
- Minecraft beds, chests, signs, banners
- A small number of GT and AE2 special blocks

These are already unresolvable by any static method and remain as gray
fallbacks on the map.
