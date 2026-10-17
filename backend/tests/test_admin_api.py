"""Admin Flask routes (UC-4.8, UC-4.9, UC-4.10 manual trigger, UC-4.11)."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest

from hougang.bootstrap import AppBootstrap
from tests.conftest import ADMIN_PASSWORD, fixture_rows, make_config, rows_to_csv

PROTECTED = [("get", "/api/admin/status"), ("post", "/api/admin/dataset"), ("post", "/api/admin/update-from-api"),
             ("get", "/api/admin/diagnostics")]


def login(client) -> dict:
    response = client.post("/api/admin/login", json={"username": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.get_json()['session_id']}"}


@pytest.mark.parametrize("method, url", PROTECTED)
def test_uc411_admin_routes_refuse_requests_without_a_session(client, method, url):
    response = getattr(client, method)(url)  # e.g. typing the URL directly (SRS 4.11.3.4)
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "unauthorized"
    bad = getattr(client, method)(url, headers={"Authorization": "Bearer forged"})
    assert bad.status_code == 401


def test_uc411_e3_wrong_credentials(client):
    response = client.post("/api/admin/login", json={"username": "admin", "password": "nope"})
    assert response.status_code == 401
    assert response.get_json()["error"]["message"] == "Invalid username or password."
    empty = client.post("/api/admin/login", json={})
    assert empty.status_code == 400 and set(empty.get_json()["error"]["fields"]) == {"username", "password"}


def test_uc411_login_then_logout(client):
    headers = login(client)
    assert client.get("/api/admin/status", headers=headers).status_code == 200
    assert client.post("/api/admin/logout", headers=headers).status_code == 200
    assert client.get("/api/admin/status", headers=headers).status_code == 401


def test_uc411_expired_session_returns_401_expired(client, services):
    headers = login(client)
    services["auth_service"]._clock = lambda: datetime.now(timezone.utc) + timedelta(hours=2)
    response = client.get("/api/admin/status", headers=headers)
    assert response.status_code == 401
    assert response.get_json()["error"]["details"]["reason"] == "expired"


def test_uc48_diagnostics(client):
    body = client.get("/api/admin/diagnostics", headers=login(client)).get_json()
    assert set(body) == {"r_squared", "adjusted_r_squared", "rmse_sgd", "coefficients", "p_values"}
    assert 0 < body["r_squared"] < 1


def test_uc48_ex1_diagnostics_without_a_model(tmp_path):
    client = AppBootstrap(make_config(tmp_path)).create_app().test_client()
    response = client.get("/api/admin/diagnostics", headers=login(client))
    assert response.status_code == 503 and response.get_json()["error"]["code"] == "model_unavailable"


def test_s8_status(client):
    body = client.get("/api/admin/status", headers=login(client)).get_json()
    assert body["total_rows"] == len(fixture_rows())
    assert {"first_month", "latest_month", "last_successful_update", "recent_updates", "needs_attention"} <= set(body)
    assert body["max_upload_mb"] == 50  # the frontend shows and enforces the configured limit


def test_uc49_upload_imports_and_retrains(tmp_path):
    client = AppBootstrap(make_config(tmp_path)).create_app().test_client()
    headers = login(client)
    data = {"file": (io.BytesIO(rows_to_csv(fixture_rows())), "resale.csv")}
    response = client.post("/api/admin/dataset", headers=headers, data=data, content_type="multipart/form-data")
    assert response.status_code == 200
    summary = response.get_json()
    assert summary["rows_added"] == len(fixture_rows()) and summary["model_retrained"] is True
    assert client.get("/api/admin/diagnostics", headers=headers).status_code == 200


def test_uc49_duplicate_upload_does_not_retrain(client):
    data = {"file": (io.BytesIO(rows_to_csv(fixture_rows()[:20])), "resale.csv")}
    summary = client.post("/api/admin/dataset", headers=login(client), data=data,
                          content_type="multipart/form-data").get_json()
    assert summary["rows_added"] == 0 and summary["model_retrained"] is False


def test_uc49_e4_rejected_upload(client):
    rows = [{k: v for k, v in r.items() if k != "resale_price"} for r in fixture_rows()[:5]]
    data = {"file": (io.BytesIO(rows_to_csv(rows)), "resale.csv")}
    response = client.post("/api/admin/dataset", headers=login(client), data=data, content_type="multipart/form-data")
    assert response.status_code == 400
    assert response.get_json()["error"]["details"]["missing_columns"] == ["resale_price"]


def test_uc49_no_file_chosen(client):
    response = client.post("/api/admin/dataset", headers=login(client), data={}, content_type="multipart/form-data")
    assert response.status_code == 400 and "file" in response.get_json()["error"]["fields"]


def test_uc49_request_over_the_size_limit_is_413(tmp_path):
    client = AppBootstrap(make_config(tmp_path, MAX_UPLOAD_MB=0)).create_app().test_client()
    headers = login(client)
    data = {"file": (io.BytesIO(b"x" * (1024 * 1024 + 10)), "big.csv")}
    response = client.post("/api/admin/dataset", headers=headers, data=data, content_type="multipart/form-data")
    assert response.status_code == 413 and "limit" in response.get_json()["error"]["message"]


def test_uc410_manual_update_uses_the_same_path(client, services, monkeypatch):
    monkeypatch.setattr(services["client"], "fetch_records", lambda: [])
    body = client.post("/api/admin/update-from-api", headers=login(client)).get_json()
    assert body["status"] == "success" and body["rows_added"] == 0 and body["model_retrained"] is False
