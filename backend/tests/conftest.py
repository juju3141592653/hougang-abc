"""Shared test fixtures.

All transaction data comes from tests/fixtures/sample_resale.csv: real rows sampled from the
data.gov.sg dataset by scripts/make_test_sample.py. The database is built once per session through
DatasetManager.import_file() and copied for each test, so tests can't affect one another.
"""

from __future__ import annotations

import csv
import io
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from werkzeug.datastructures import FileStorage

from hougang.bootstrap import AppBootstrap
from hougang.config import load_config

FIXTURE_CSV = Path(__file__).parent / "fixtures" / "sample_resale.csv"
ADMIN_PASSWORD = "correct horse battery staple"


def make_config(directory: Path, **overrides) -> dict:
    return load_config(
        {
            "DB_PATH": str(directory / "test.db"),
            "MODEL_ARTEFACT_PATH": str(directory / "model_artefact.json"),
            "RAW_DATA_DIR": str(directory / "raw"),
            "SCHEDULER_ENABLED": False,
            "DATA_GOV_SG_API_KEY": None,
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD": ADMIN_PASSWORD,
            "ADMIN_PASSWORD_HASH": None,
            "FRONTEND_DIST": str(directory / "no-frontend-build"),
            **overrides,
        }
    )


def file_upload(data: bytes, filename: str) -> FileStorage:
    return FileStorage(stream=io.BytesIO(data), filename=filename)


def fixture_rows() -> list[dict]:
    with open(FIXTURE_CSV, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def rows_to_csv(rows: list[dict], fieldnames: list[str] | None = None) -> bytes:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fieldnames or list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _copy_sqlite(source: str, target: str) -> None:
    with closing(sqlite3.connect(source)) as src, closing(sqlite3.connect(target)) as dst:
        src.backup(dst)


@pytest.fixture(scope="session")
def loaded_template(tmp_path_factory) -> dict:
    """A database (and, once the model exists, an artefact) built from the real sample."""
    directory = tmp_path_factory.mktemp("template")
    app = AppBootstrap(make_config(directory)).create_app()
    services = app.extensions["hougang"]
    with open(FIXTURE_CSV, "rb") as fh:
        services["dataset_manager"].import_file(FileStorage(stream=fh, filename="sample_resale.csv"))
    template = {"db": str(directory / "test.db"), "artefact": None}
    if "prediction_manager" in services:
        services["prediction_manager"].retrain()
        template["artefact"] = str(directory / "model_artefact.json")
    return template


@pytest.fixture
def config(tmp_path, loaded_template) -> dict:
    """Config pointing at a private copy of the loaded database and model artefact."""
    cfg = make_config(tmp_path)
    _copy_sqlite(loaded_template["db"], cfg["DB_PATH"])
    if loaded_template["artefact"]:
        Path(cfg["MODEL_ARTEFACT_PATH"]).write_bytes(Path(loaded_template["artefact"]).read_bytes())
    return cfg


@pytest.fixture
def app(config):
    return AppBootstrap(config).create_app()


@pytest.fixture
def services(app) -> dict:
    return app.extensions["hougang"]


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def empty_services(tmp_path) -> dict:
    """Services over an empty database (no data, no model), in its own folder."""
    return AppBootstrap(make_config(tmp_path / "empty")).create_app().extensions["hougang"]
