"""AppBootstrap: database initialisation, wiring, password handling, daily job, frontend serving."""

from __future__ import annotations

import sqlite3

from hougang.bootstrap import DAILY_JOB_ID, AppBootstrap
from tests.conftest import fixture_rows, make_config


def test_initialise_database_creates_schema_and_is_idempotent(tmp_path):
    bootstrap = AppBootstrap(make_config(tmp_path / "nested"))
    bootstrap.initialise_database()
    bootstrap.initialise_database()
    conn = sqlite3.connect(tmp_path / "nested" / "test.db")
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    triggers = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")}
    conn.close()
    assert {"transactions", "update_status"} <= tables
    assert {"transactions_no_update", "transactions_no_delete"} <= triggers


def test_create_app_wires_every_service(tmp_path):
    services = AppBootstrap(make_config(tmp_path)).create_app().extensions["hougang"]
    assert {"repository", "model", "client", "search_manager", "prediction_manager", "auth_service",
            "dataset_manager"} <= set(services)
    assert "scheduler" not in services  # disabled in tests


def test_plaintext_admin_password_is_dropped_from_config(tmp_path):
    config = make_config(tmp_path)
    bootstrap = AppBootstrap(config)
    bootstrap.create_app()
    assert bootstrap._config["ADMIN_PASSWORD"] is None
    assert config["ADMIN_PASSWORD"]  # the caller's dict is not modified


def test_uc410_daily_job_is_scheduled_at_3am_singapore(tmp_path):
    services = AppBootstrap(make_config(tmp_path, SCHEDULER_ENABLED=True)).create_app().extensions["hougang"]
    scheduler = services["scheduler"]
    try:
        job = scheduler.get_job(DAILY_JOB_ID)
        assert job is not None
        next_run = job.next_run_time
        assert (next_run.hour, next_run.minute) == (3, 0) and str(next_run.tzinfo) == "Asia/Singapore"
    finally:
        scheduler.shutdown(wait=False)


def test_uc410_daily_job_appends_and_retrains(tmp_path, monkeypatch):
    bootstrap = AppBootstrap(make_config(tmp_path))
    services = bootstrap.create_app().extensions["hougang"]
    records = [{"_id": i, **r} for i, r in enumerate(fixture_rows(), 1)]
    monkeypatch.setattr(services["client"], "fetch_records", lambda: records)
    summary = bootstrap._run_daily_update()
    assert summary["rows_added"] == len(records)
    assert services["prediction_manager"].get_diagnostics().r_squared > 0


def test_built_frontend_is_served_with_client_side_routes(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<div id=root></div>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    client = AppBootstrap(make_config(tmp_path, FRONTEND_DIST=str(dist))).create_app().test_client()
    assert b"root" in client.get("/").data
    assert b"root" in client.get("/results/12").data  # React Router path
    assert b"console" in client.get("/assets/app.js").data
    assert client.get("/api/missing").status_code == 404


def test_frontend_route_does_not_reveal_files_outside_dist(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<div id=root></div>")
    (tmp_path / "secret.txt").write_text("not public")
    client = AppBootstrap(make_config(tmp_path, FRONTEND_DIST=str(dist))).create_app().test_client()
    existing = client.get("/../secret.txt")
    missing = client.get("/../no-such-file.txt")
    assert existing.status_code == missing.status_code
    assert b"not public" not in existing.data


def test_daily_job_survives_unexpected_errors(tmp_path, monkeypatch):
    bootstrap = AppBootstrap(make_config(tmp_path))
    services = bootstrap.create_app().extensions["hougang"]

    def boom():
        raise RuntimeError("unexpected")

    monkeypatch.setattr(services["dataset_manager"], "update_from_api", boom)
    assert bootstrap._run_daily_update()["status"] == "failed"
