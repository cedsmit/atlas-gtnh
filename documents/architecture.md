# Architecture

## Overview

Atlas GTNH is a desktop application for loading, visualizing, and editing Minecraft GregTech: New Horizons worlds without launching the game. It runs as three coordinated processes: a Tauri desktop shell, a React/Three.js frontend, and a FastAPI backend.

```
┌────────────────────────────────────────────┐
│             Tauri Desktop Shell            │
│        (window, file dialogs, IPC)         │
└─────────────────┬──────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
┌──────▼────────┐   ┌────────▼──────────┐
│   React UI    │   │  FastAPI Backend  │
│  (port 1420)  │◄──►  (port 8000)      │
│               │   │                   │
│  Three.js     │   │  Amulet-Core      │
│  Zustand      │   │  NBTLib           │
│  TanStack Q   │   │  SQLite           │
└───────────────┘   └────────┬──────────┘
                             │
                     ┌───────▼───────┐
                     │  World Files  │
                     │  (.mca / .nbt)│
                     └───────────────┘
```

---

## Components

### Tauri Shell (`frontend/src-tauri/`)

- Wraps the React app in a native window (Windows/macOS/Linux)
- Provides native file dialogs via `@tauri-apps/api`
- Launches the FastAPI backend process on startup via the Shell plugin
- Entry points: `main.rs`, `lib.rs`

### React Frontend (`frontend/src/`)

| Directory | Responsibility |
|-----------|----------------|
| `api/` | HTTP client wrappers for FastAPI endpoints |
| `components/` | Reusable UI components |
| `features/` | Feature-scoped modules (world viewer, editor) |
| `hooks/` | Shared custom hooks |
| `pages/` | Top-level page components |

**Key libraries:**
- **Three.js + React Three Fiber** — 3D chunk/block rendering
- **Zustand** — client-side UI state
- **TanStack Query** — server state, caching, background refetch
- **Tailwind CSS** — styling

### FastAPI Backend (`backend/app/`)

| Directory | Responsibility |
|-----------|----------------|
| `api/` | Route handlers (REST endpoints) |
| `services/` | Business logic (world operations, edits) |
| `models/` | Pydantic request/response schemas |
| `database/` | SQLite session management via SQLModel |
| `world/` | Amulet-Core integration for `.mca` I/O |

**Key libraries:**
- **Amulet-Core** — reads and writes MCRegion/Anvil `.mca` region files
- **NBTLib** — parses NBT data (block properties, tile entities, GT machines)
- **SQLModel** — ORM for SQLite metadata
- **Pydantic v2** — validation on all API boundaries

### Storage

- **`.mca` region files** — authoritative block and chunk data; never fully loaded into memory
- **SQLite** — lightweight metadata cache (loaded regions, dirty chunks, edit history); kept in sync with world files on save

---

## Data Flow

### Loading a world

```
1. User picks world folder  →  Tauri file dialog
2. Frontend sends path      →  POST /worlds/load
3. Backend scans .mca files via Amulet-Core
4. Chunk metadata written to SQLite
5. Backend returns region list + initial chunk data
6. Frontend builds Three.js geometry from chunk data
7. World renders in 3D viewport
```

### Editing a block

```
1. User clicks block in 3D view  →  Three.js ray cast
2. Frontend sends edit           →  PATCH /blocks/{x}/{y}/{z}
3. Backend updates in-memory chunk model
4. Chunk marked dirty in SQLite
5. Frontend receives updated block state
6. Three.js mesh patched (no full re-render)
```

### Saving

```
1. User triggers save    →  POST /worlds/save
2. Backend collects all dirty chunks from SQLite
3. Amulet-Core serialises each chunk
4. Chunk data written back to .mca region files
5. SQLite dirty flags cleared
6. Frontend notified: save complete
```

### Frontend ↔ Backend communication

All communication is plain HTTP over localhost. Tauri's CSP allows `http://localhost:8000`. TanStack Query handles caching, retries, and background invalidation on the frontend side.

---

## Quality & CI

| Concern | Tool |
|---------|------|
| Python types | MyPy (strict) |
| Python lint/format | Ruff |
| Python tests | Pytest |
| TS types | TypeScript (strict) |
| TS lint/format | ESLint + Prettier |
| TS tests | Vitest |
| Pre-commit | Husky (frontend), pre-commit (backend) |
| CI | GitHub Actions — runs on push to `main`/`dev` |

The backend CI job runs on `windows-latest` to match the target platform's native dependency behaviour.
