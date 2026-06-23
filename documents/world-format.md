# World Format

## Overview

This document describes the internal world representation used by Atlas GTNH.

The goal of this format is to provide a simplified and editable representation of a Minecraft world that can be visualized, modified, and exported without launching Minecraft itself.

The initial implementation focuses on:

- Loading GTNH world data
- Visualizing chunks and blocks
- Editing block placements
- Saving modifications back to disk

---

## Supported Minecraft Version

Current target:

- Minecraft 1.7.10
- GregTech: New Horizons

World data is read directly from the vanilla Minecraft save format.

---

## World Structure

A world consists of:

```text
World
├── Region Files
│   ├── Chunk
│   │   ├── Block Data
│   │   ├── Metadata
│   │   └── Tile Entities
│   └── ...
└── World Metadata
```

---

## Coordinate System

Atlas GTNH uses the standard Minecraft coordinate system.

| Axis | Direction     |
| ---- | ------------- |
| X    | East / West   |
| Y    | Height        |
| Z    | North / South |

Example:

```json
{
    "x": 120,
    "y": 64,
    "z": -32
}
```

---

## Chunk Representation

A chunk represents a 16×16 area of blocks.

```json
{
    "chunkX": 5,
    "chunkZ": -2
}
```

Chunk dimensions:

```text
Width  = 16 blocks
Length = 16 blocks
Height = 256 blocks
```

---

## Block Representation

Each block contains:

```json
{
    "id": "minecraft:stone",
    "meta": 0,
    "x": 120,
    "y": 64,
    "z": -32
}
```

### Fields

| Field | Description          |
| ----- | -------------------- |
| id    | Block identifier     |
| meta  | Block metadata value |
| x     | World X coordinate   |
| y     | World Y coordinate   |
| z     | World Z coordinate   |

---

## Tile Entities

Some blocks contain additional NBT data.

Examples:

- Chests
- GregTech Machines
- Furnaces
- Pipes
- Cables

Example:

```json
{
    "id": "gregtech:machine",
    "position": {
        "x": 100,
        "y": 65,
        "z": 100
    },
    "nbt": {}
}
```

Tile entity support is planned for a future milestone.

---

## World Metadata

World metadata contains:

```json
{
    "worldName": "GTNH Base",
    "seed": 123456789,
    "spawn": {
        "x": 0,
        "y": 80,
        "z": 0
    }
}
```

---

## Rendering Model

The renderer only loads visible chunks.

Workflow:

```text
Region File
    ↓
Chunk Parser
    ↓
Internal Chunk Model
    ↓
Mesh Generation
    ↓
3D Renderer
```

Future optimizations:

- Frustum culling
- Chunk caching
- Level of Detail (LOD)
- GPU instancing

---

## Editing Operations

Supported operations:

- Place block
- Remove block
- Replace block
- Fill selection
- Copy selection
- Paste selection

Each operation modifies the internal world model before saving.

---

## Save Pipeline

```text
World Model
    ↓
Chunk Serialization
    ↓
Region File Update
    ↓
Minecraft Save Folder
```

Only modified chunks should be written back to disk.

---

## Future Extensions

Planned features:

- Full NBT editing
- GregTech machine support
- Entity support
- Schematics import/export
- Undo/Redo history
- Multi-user editing
- World diff system
- Blueprint format
