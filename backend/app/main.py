from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.worlds.routers import router as worlds_router

app = FastAPI(title="Atlas GTNH", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(worlds_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
