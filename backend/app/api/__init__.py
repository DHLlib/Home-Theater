"""API domain routers.

按 entry-point-contract.yaml 约定，每个 domain 目录导出 router。
Assembly Agent 通过扫描此包收集所有已注册路由。
"""
from .downloads import router as downloads_router
from .favorites import router as favorites_router
from .play import router as play_router
from .progress import router as progress_router
from .settings_api import router as settings_router
from .sites import router as sites_router
from .sse import router as sse_router
from .videos import router as videos_router

__all__ = [
    "downloads_router",
    "favorites_router",
    "play_router",
    "progress_router",
    "settings_router",
    "sites_router",
    "sse_router",
    "videos_router",
]
