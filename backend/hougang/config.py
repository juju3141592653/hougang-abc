"""Runtime configuration, read from environment variables (see `.env.example`).

`AppBootstrap` receives the resulting dict as its `config` attribute and hands each service the
values it needs. Thresholds the SRS calls "configurable" (TBD-07, UC-4.9 file-size limit) live here.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

# data.gov.sg: "Resale flat prices based on registration date from Jan-2017 onwards" (UC-4.10).
HDB_RESALE_DATASET_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc"


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value not in (None, "") else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value not in (None, "") else default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def load_config(overrides: dict | None = None) -> dict:
    """Build the configuration dict from the environment, then apply `overrides` (used by tests)."""
    data_dir = Path(os.environ.get("HOUGANG_DATA_DIR") or BACKEND_DIR / "data")
    config = {
        # Persistence
        "DB_PATH": os.environ.get("DB_PATH") or str(data_dir / "hougang.db"),
        "MODEL_ARTEFACT_PATH": os.environ.get("MODEL_ARTEFACT_PATH") or str(data_dir / "model_artefact.json"),
        "RAW_DATA_DIR": str(data_dir / "raw"),
        # data.gov.sg (UC-4.10, NFR 5.1.2)
        "DATASET_ID": os.environ.get("DATASET_ID") or HDB_RESALE_DATASET_ID,
        "DATA_GOV_SG_API_KEY": os.environ.get("DATA_GOV_SG_API_KEY") or None,
        "API_TIMEOUT_SECONDS": _env_int("API_TIMEOUT_SECONDS", 10),
        "FETCH_LOOKBACK_MONTHS": _env_int("FETCH_LOOKBACK_MONTHS", 3),
        # Search (UC-4.1 to UC-4.4)
        "PAGE_SIZE": _env_int("PAGE_SIZE", 24),
        "RECENT_MONTHS": _env_int("RECENT_MONTHS", 12),
        "FLOOR_AREA_TOLERANCE_SQM": _env_float("FLOOR_AREA_TOLERANCE_SQM", 5.0),
        # Prediction (UC-4.5 to UC-4.7, TBD-07)
        "TRAINING_WINDOW_MONTHS": _env_int("TRAINING_WINDOW_MONTHS", 24),
        "MIN_SAMPLES": _env_int("MIN_SAMPLES", 30),
        # Dataset management (UC-4.9)
        "MAX_UPLOAD_MB": _env_int("MAX_UPLOAD_MB", 50),
        # Admin authorization (UC-4.11). The plaintext password is hashed and dropped at startup.
        "ADMIN_USERNAME": os.environ.get("ADMIN_USERNAME") or "admin",
        "ADMIN_PASSWORD": os.environ.get("ADMIN_PASSWORD") or None,
        "ADMIN_PASSWORD_HASH": os.environ.get("ADMIN_PASSWORD_HASH") or None,
        "SESSION_IDLE_MINUTES": _env_int("SESSION_IDLE_MINUTES", 30),
        # Daily update job (UC-4.10)
        "SCHEDULER_ENABLED": _env_bool("SCHEDULER_ENABLED", True),
        "DAILY_JOB_HOUR": _env_int("DAILY_JOB_HOUR", 3),
        "TIMEZONE": os.environ.get("TIMEZONE") or "Asia/Singapore",
        # Built React app, served by Flask when present
        "FRONTEND_DIST": os.environ.get("FRONTEND_DIST") or str(REPO_DIR / "frontend" / "dist"),
    }
    if overrides:
        config.update(overrides)
    return config
