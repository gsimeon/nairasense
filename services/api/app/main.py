from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.db import check_db_ready
from app.routes.auth import router as auth_router
from app.routes.cash import router as cash_router
from app.routes.preferences import router as preferences_router
from app.routes.transactions import router as transactions_router
from app.settings import settings

app = FastAPI(
    title="NairaSense API",
    version="0.1.0",
    description="NairaSense API. Banknote inference is currently a mock implementation.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(cash_router, prefix="/api/v1")
app.include_router(transactions_router, prefix="/api/v1")
app.include_router(preferences_router, prefix="/api/v1")


@app.get("/health", tags=["operations"])
def health() -> dict[str, str]:
    return {"status": "ok", "implementation": "starter"}


@app.get("/ready", tags=["operations"])
def ready() -> dict[str, str]:
    if not check_db_ready():
        raise HTTPException(status_code=503, detail="Database is not ready.")
    return {"status": "ready", "database": "ok"}
