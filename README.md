# Atlas GTNH

A desktop world editor for Minecraft GT:NH.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | TypeScript + React + Vite + Three.js + React Three Fiber |
| State | Zustand + TanStack Query |
| Styling | Tailwind CSS |
| Backend | Python 3.12 + FastAPI |
| World I/O | Hand-rolled MCA reader/writer (NBTLib + NumPy) |
| Database | SQLite (raw sqlite3) |

## Project structure

```
atlas-gtnh/
├── backend/          # FastAPI + Python
│   ├── app/
│   │   ├── api/      # Route handlers
│   │   ├── services/ # Business logic
│   │   ├── world/    # MCA region I/O (nbtlib + numpy)
│   │   └── models/   # Pydantic models
│   └── tests/
├── frontend/         # Tauri + React + Vite
│   ├── src/
│   │   ├── features/ # Feature modules (map, world, blocks, textures, …); each has its own api/
│   │   ├── shared/   # Cross-feature UI + API base
│   │   └── src-tauri # (sibling) Rust shell
├── tools/            # atlas-dumper (Forge mod that dumps block→texture mappings)
└── docs/
    ├── CurrentScope.md  # living roadmap + current status
    ├── design/          # architecture, world-format, texture-resolution (some sections aspirational)
    └── reports/         # point-in-time analyses / audits
```

> World saves are opened from any path via the native file dialog — there is no in-repo `worlds/` folder. Local `uploads/` is git-ignored.

## Prerequisites

- [Python 3.12](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/)
- [Node.js 22+](https://nodejs.org/)
- [Rust](https://rustup.rs/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — "Desktop development with C++" workload

## Setup

```bash
# Backend
cd backend && uv sync

# Frontend
cd frontend && npm install

# Root (dev runner)
npm install
```

**Git hooks** (after `git init`)

```bash
cd backend && uv run pre-commit install
```

Husky activates automatically via `npm install` in the frontend.

## Running

```bash
npm run dev
```

Starts both the FastAPI backend and the Tauri desktop app. Output is labeled `[api]` and `[app]`.

To run them separately:

```bash
npm run dev:api   # FastAPI only (port 8000)
npm run dev:app   # Tauri + Vite only (port 1420)
```

## Linting

| Tool | Command | Runs on |
|---|---|---|
| Ruff lint | `uv run ruff check .` | commit + CI |
| Ruff format | `uv run ruff format .` | commit + CI |
| mypy | `uv run mypy .` | commit + CI |
| ESLint | `npm run lint` | commit + CI |

## Testing

```bash
# Backend
cd backend && uv run pytest

# Frontend
cd frontend && npm run test:run
```

## CI

GitHub Actions runs on every push and pull request:

- **backend**: ruff lint → ruff format check → mypy → pytest
- **frontend**: ESLint → vitest → `tsc -b && vite build`

## Architecture

```
Tauri shell
└── React + Vite UI (port 1420)
    └── Three.js / React Three Fiber

FastAPI backend (port 8000)
└── Hand-rolled MCA I/O (NBTLib + NumPy)
    └── GTNH world files

SQLite (metadata only — chunk/block data stays in the world files)
```
