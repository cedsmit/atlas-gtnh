# Bundled data — canonical dumps shipped with Atlas

Files here ship **inside** Atlas so end users get correct rendering with **zero
setup** — no need to run the AtlasDumper mod themselves.

## Layout — one folder per GTNH major version

```
data/
  2.8/
    biome_dump.json       # per-biome grass/foliage colours (dumper output verbatim)
    icon_dump.json.gz     # block→texture-key mapping, gzipped (~4% of raw 13 MB)
  2.9/                    # future major — same two files, detection extends automatically
    ...
```

| file | consumed by | purpose |
|------|-------------|---------|
| `<major>/biome_dump.json` | `services/biome_color_service.py` | Canonical per-biome grass/foliage colours. |
| `<major>/icon_dump.json.gz` | `services/blockcolor/resolution.py` (`_bundled_icon_dump`) | Canonical block→texture-key mapping; the user's own textures supply the pixels. |

Both are **deterministic for a given pack build** — the same for every player — so
we capture them once and bundle them. A player with their own dump (`ATLAS_*` env,
instance `config/atlas/`, or `~/.atlas_gtnh/`) still overrides the bundled copy;
everyone else falls back to the version-selected `data/<major>/` file automatically.
The **major version is detected from the world's ModList** (`services/pack_version.py`)
by matching GTNH anchor mods against each dataset's `mods` signature — so nothing
here needs a hardcoded version list.

> **Provenance / licensing:** these are *derived metadata* (colour numbers +
> icon-name strings) computed from the pack, not texture assets. No copyrighted
> texture PNGs are ever redistributed here — the actual pixels only ever come from
> the user's own GTNH install.

## Regenerating (maintainer only)

The dumper (`tools/atlas-dumper/`) is a **maintainer tool**, not part of the
end-user flow. To add/refresh a major version:

1. Build the mod: run `tools/atlas-dumper/build.bat`.
2. Drop the jar in a reference GTNH instance of that major, launch the client,
   **load a world once** (biome colormaps + the block registry aren't ready before
   then). This writes `config/atlas/icon_dump.json` **and** `biome_dump.json`.
3. Place them under `data/<major>/`:
   ```
   config\atlas\biome_dump.json  →  backend/app/data/<major>/biome_dump.json   (verbatim)
   config\atlas\icon_dump.json   →  gzip → backend/app/data/<major>/icon_dump.json.gz
   ```
   Gzip the icon dump (it's ~13 MB raw, ~0.5 MB gzipped), e.g.:
   ```bash
   python -c "import gzip,shutil; shutil.copyfileobj(open('icon_dump.json','rb'), gzip.open('icon_dump.json.gz','wb',9))"
   ```
4. Commit, noting the pack build in the message. Detection picks up the new folder
   with no code change.

No transformation of contents is needed — the resolvers read the dumper output
as-is (`atlas-gtnh-biome-dump-v1` / `atlas-gtnh-icon-dump-v1`); `biome_dump.json`
stays plain JSON (it also carries the `mods` signature used for version detection),
`icon_dump.json` is only gzipped.
