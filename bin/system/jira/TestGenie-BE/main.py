# main.py
import os
import sys
import logging
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

from app.core.config import settings
from app.core.exception_handlers import setup_exception_handlers
from app.routers import jira, test_case, zephyr
from app.auth.auth_atlassian import router as atlassian_router
from app.middleware.logging_middleware import RequestLoggingMiddleware
from app.middleware.rate_limit import RateLimitMiddleware

logger = logging.getLogger("uvicorn.error")

def resource_path(rel_path: str) -> str:
    """Return absolute path to resource for both dev and PyInstaller onefile."""
    base = getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)
    return str(Path(base) / rel_path)

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Test Management System with Jira and Zephyr Squad integration",
    docs_url="/docs",
    redoc_url="/redoc",
    debug=settings.debug,
)

setup_exception_handlers(app)

# Add custom middleware
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware, requests_per_minute=100)  # 100 requests per minute per IP

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173", "http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jira.router)
app.include_router(test_case.router)
app.include_router(zephyr.router)
app.include_router(atlassian_router)

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app_name": settings.app_name, "version": settings.app_version, "debug": settings.debug}

# Frontend mount + fallback
FRONTEND_DIR = Path(resource_path("frontend"))
if FRONTEND_DIR.is_dir() and (FRONTEND_DIR / "index.html").exists():
    logger.info(f"[Frontend] Serving from: {FRONTEND_DIR}")
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, request: Request):
        if request.url.path.startswith("/api/"):
            return FileResponse(FRONTEND_DIR / "index.html", status_code=404)
        return FileResponse(FRONTEND_DIR / "index.html")
else:
    logger.warning("[Frontend] Not found inside bundle. Place 'frontend' correctly or rebuild with --add-data")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, 
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        log_level="debug" if settings.debug else "info",
    )
