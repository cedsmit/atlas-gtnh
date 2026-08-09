# Render presets

Each JSON file defines one built-in map look. Vite bundles every file in this
directory; `loadRenderPresets` validates them at startup and orders them by the
top-level `order` value.

- Keep `schemaVersion` at `1` until the loader is deliberately migrated.
- Preset IDs are persistence keys. Never rename one without migrating saved
  render preferences and user presets.
- `journeymap` must remain first because unknown or removed saved IDs fall back
  to the first preset.
- JourneyMap intentionally uses the `pixel` texture filter. The similarly named
  `journeymap` filter upscales and smooths textures, which is more expensive and
  made the map look desaturated.
- Unknown fields, invalid enum values, duplicate IDs, and out-of-range numeric
  values are rejected instead of being silently ignored.
