# Bundled data — canonical dumps shipped with Atlas

Files here ship **inside** Atlas so end users get correct rendering with **zero
setup** — no need to run the AtlasDumper mod themselves.

| file | consumed by | purpose |
|------|-------------|---------|
| `biome_dump.json` | `services/biome_color_service.py` | Canonical per-biome grass/foliage colours for the GTNH pack. Final fallback in the resolver, below any per-instance dump. |

Biome grass/foliage colours are **deterministic for a given modpack build** — the
same for every player — so we capture them once and bundle them. A player who
*does* have their own `config/atlas/biome_dump.json` (env, instance, or
`~/.atlas_gtnh/`) still overrides the bundled default; everyone else falls back to
this file automatically. See the resolver order in `biome_color_service.py`.

## Regenerating (maintainer only)

The dumper (`tools/forge-icon-dumper/`) is a **maintainer tool**, not part of the
end-user flow. To refresh the canonical dataset after a pack update:

1. Build the mod: run `tools/forge-icon-dumper/build.bat`.
2. Drop the jar in the GTNH instance's `mods/`, launch the client, **load a world
   once** (biome colormaps aren't ready before then).
3. Copy the generated dump into this folder:
   ```
   <instance>\.minecraft\config\atlas\biome_dump.json  →  backend/app/data/biome_dump.json
   ```
4. Commit it. Note the pack build it came from in the commit message.

The file is the dumper's output verbatim (`format: atlas-gtnh-biome-dump-v1`), so
no transformation is needed — `biome_color_service._parse` reads it as-is.
