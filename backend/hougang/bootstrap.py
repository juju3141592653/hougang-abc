"""<<startup>> AppBootstrap: creates Flask, initialises SQLite, loads the model, wires managers and
adapters, and configures the daily job (architecture diagram, "STARTUP" layer)."""

from __future__ import annotations

import atexit
import logging
import sqlite3
from contextlib import closing
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from flask import Flask, abort, send_from_directory
from werkzeug.security import generate_password_hash, safe_join

from hougang.adapters.data_gov_client import DataGovClient
from hougang.adapters.ols_regression_model import OLSRegressionModel
from hougang.adapters.transaction_repository import SCHEMA_SQL, TransactionRepository
from hougang.config import load_config
from hougang.controls.admin_auth_service import AdminAuthService
from hougang.controls.dataset_manager import DatasetManager
from hougang.controls.prediction_manager import PredictionManager
from hougang.controls.search_manager import SearchManager
from hougang.errors import HougangError, InsufficientDataError, ModelUnavailableError
from hougang.routes import admin_api, public_api
from hougang.routes.serializers import register_error_handlers

logger = logging.getLogger(__name__)

DAILY_JOB_ID = "daily-data-gov-update"


class AppBootstrap:
    """<<startup>> Builds the application. `config` is the diagram's private attribute; the plaintext
    admin password is removed from it as soon as it has been hashed."""

    def __init__(self, config: dict | None = None):
        self._config = dict(config if config is not None else load_config())
        self._services: dict = {}

    def create_app(self) -> Flask:
        """Create the Flask app with every service wired in (all use cases)."""
        app = Flask(__name__, static_folder=None)
        app.config["MAX_CONTENT_LENGTH"] = (self._config["MAX_UPLOAD_MB"] + 1) * 1024 * 1024
        app.config["SESSION_IDLE_MINUTES"] = self._config["SESSION_IDLE_MINUTES"]
        app.config["UPLOAD_LIMIT_MB"] = self._config["MAX_UPLOAD_MB"]
        app.config["FLOOR_AREA_TOLERANCE_SQM"] = self._config["FLOOR_AREA_TOLERANCE_SQM"]
        app.json.sort_keys = False
        self.initialise_database()
        self._wire_services()
        app.extensions["hougang"] = self._services
        app.register_blueprint(public_api.bp)
        app.register_blueprint(admin_api.bp)
        register_error_handlers(app, self._config["MAX_UPLOAD_MB"])
        self.load_model()
        if self._config["SCHEDULER_ENABLED"]:
            self.configure_daily_job()
        self._serve_frontend(app)
        return app

    def initialise_database(self) -> None:
        """Create the SQLite file and schema if they don't exist yet."""
        db_path = Path(self._config["DB_PATH"])
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db_path)) as conn:
            conn.executescript(SCHEMA_SQL)

    def load_model(self) -> None:
        """Load the saved OLS artefact; if there is none but data exists, train one (UC-4.5 precondition 2).

        With no data and no artefact the app still starts: predictions and diagnostics then report
        "model unavailable" (UC-4.8 EX.1) until data is imported.
        """
        if not self._services:
            self._wire_services()
        try:
            self._services["model"].load()
            return
        except ModelUnavailableError as exc:
            logger.info("No usable model artefact (%s)", exc.message)
        if self._services["repository"].dataset_stats()["total_rows"]:
            try:
                self._services["prediction_manager"].retrain()
            except InsufficientDataError as exc:
                logger.warning("Model not trained: %s", exc.message)

    def configure_daily_job(self) -> None:
        """Schedule DatasetManager.update_from_api() every day (UC-4.10 REQ-1, no manual trigger needed)."""
        if not self._services:
            self._wire_services()
        if self._services.get("scheduler"):
            return
        scheduler = BackgroundScheduler(timezone=self._config["TIMEZONE"])
        scheduler.add_job(
            self._run_daily_update,
            CronTrigger(hour=self._config["DAILY_JOB_HOUR"], minute=0, timezone=self._config["TIMEZONE"]),
            id=DAILY_JOB_ID,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
        )
        scheduler.start()
        atexit.register(lambda: scheduler.shutdown(wait=False) if scheduler.running else None)
        self._services["scheduler"] = scheduler
        logger.info("Daily data.gov.sg update scheduled at %02d:00 %s", self._config["DAILY_JOB_HOUR"],
                    self._config["TIMEZONE"])

    # ------------------------------------------------------------------ private helpers

    def _wire_services(self) -> None:
        if self._services:
            return
        cfg = self._config
        password_hash = cfg.get("ADMIN_PASSWORD_HASH")
        if not password_hash and cfg.get("ADMIN_PASSWORD"):
            password_hash = generate_password_hash(cfg["ADMIN_PASSWORD"])
        cfg["ADMIN_PASSWORD"] = None  # only the hash is kept (SRS 5.3.1)
        if not password_hash:
            logger.warning("ADMIN_PASSWORD is not set: admin login is disabled.")

        repository = TransactionRepository(
            cfg["DB_PATH"],
            page_size=cfg["PAGE_SIZE"],
            recent_months=cfg["RECENT_MONTHS"],
            floor_area_tolerance_sqm=cfg["FLOOR_AREA_TOLERANCE_SQM"],
            training_window_months=cfg["TRAINING_WINDOW_MONTHS"],
        )
        model = OLSRegressionModel(cfg["MODEL_ARTEFACT_PATH"])
        client = DataGovClient(
            cfg["DATASET_ID"],
            timeout_seconds=cfg["API_TIMEOUT_SECONDS"],
            api_key=cfg["DATA_GOV_SG_API_KEY"],
            lookback_months=cfg["FETCH_LOOKBACK_MONTHS"],
        )
        self._services.update(
            repository=repository,
            model=model,
            client=client,
            search_manager=SearchManager(repository),
            prediction_manager=PredictionManager(
                model, repository, min_samples=cfg["MIN_SAMPLES"], training_window_months=cfg["TRAINING_WINDOW_MONTHS"]
            ),
            auth_service=AdminAuthService(
                password_hash, username=cfg["ADMIN_USERNAME"], idle_minutes=cfg["SESSION_IDLE_MINUTES"]
            ),
            dataset_manager=DatasetManager(repository, client, max_upload_mb=cfg["MAX_UPLOAD_MB"]),
        )

    def _run_daily_update(self) -> dict:
        """The scheduled job: fetch new records, append them, and retrain if anything was added.

        Never raises: an unexpected error is logged so the scheduler keeps running the next day.
        """
        try:
            summary = self._services["dataset_manager"].update_from_api()
        except Exception:
            logger.exception("Daily update failed")
            return {"source": "api", "status": "failed"}
        logger.info("Daily update: %s, %s row(s) added", summary["status"], summary.get("rows_added", 0))
        if summary.get("rows_added"):
            try:
                self._services["prediction_manager"].retrain()
            except HougangError as exc:
                logger.warning("Retrain after daily update failed: %s", exc.message)
            except Exception:
                logger.exception("Retrain after daily update failed")
        return summary

    def _serve_frontend(self, app: Flask) -> None:
        """Serve the built React app (frontend/dist) when it exists; React Router handles the paths."""
        dist = Path(self._config["FRONTEND_DIST"])
        if not (dist / "index.html").exists():
            return

        @app.get("/", defaults={"path": ""})
        @app.get("/<path:path>")
        def frontend(path: str):
            if path.startswith("api/"):
                abort(404)
            if path:
                safe = safe_join(str(dist), path)  # None for paths that escape dist (e.g. "../")
                if safe is None:
                    abort(404)
                if Path(safe).is_file():
                    return send_from_directory(dist, path)
            return send_from_directory(dist, "index.html")
