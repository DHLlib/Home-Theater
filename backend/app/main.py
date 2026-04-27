import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.logging_config import setup_logging
from app.services.downloader import download_worker
from app.services.scheduler import init_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await init_db()
    worker_task = asyncio.create_task(download_worker())
    scheduler_task = await init_scheduler()
    yield
    worker_task.cancel()
    scheduler_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Home Theater", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api import favorites, downloads, play, progress, settings_api, sites, videos

app.include_router(sites.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(play.router, prefix="/api")
app.include_router(downloads.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


_frontend_dist = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "dist"
)
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
