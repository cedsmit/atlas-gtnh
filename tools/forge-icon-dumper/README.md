# Atlas Icon Dumper

A small Forge 1.7.10 client-side mod that exports the exact block→texture
mapping Minecraft uses, enabling Atlas GTNH to resolve block textures without
heuristics.

## What it does

After the game stitches the blocks texture atlas (all `registerBlockIcons()`
calls have completed), it iterates every registered block and calls
`block.getIcon(side, meta)` via reflection for all 16 metadata values and 6
sides.

The icon names from `IIcon.getIconName()` — the same strings Minecraft's own
renderer uses — are written to:

```
.minecraft/config/atlas/icon_dump.json
```

## Installation (pre-built)

The JAR at `tools/forge-icon-dumper/atlas-icon-dumper-1.0.0.jar` is ready to
use. Copy it to your GTNH `mods/` folder.

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

```cmd
javac --release 8 ^
  -cp "path\to\forge-universal.jar;path\to\minecraft-client.jar" ^
  -d out ^
  src\main\java\com\atlasgtnh\icondumper\AtlasDumper.java
```

### Package

```cmd
jar cf atlas-icon-dumper-1.0.0.jar -C out .
```

### Notes on vanilla JAR

The vanilla JAR is only needed **at compile time** so javac can resolve the
class hierarchy of Forge's `FMLControlledNamespacedRegistry`. Our compiled
bytecode references only Forge classes; all vanilla Minecraft method calls go
through `java.lang.reflect.Method` by MCP name, which are available at runtime
because Forge's class loader deobfuscates them.

## Running

Launch the GTNH client normally. When the main menu appears, the dump is
already complete. You do NOT need to load a world.

Watch the game log for:
```
[AtlasDumper] Done — 4012/4095 blocks (61 no-icon, 22 unnamed), 289 mods, 83 errors → .minecraft/config/atlas/icon_dump.json
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
