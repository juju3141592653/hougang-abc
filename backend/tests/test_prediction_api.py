"""POST /api/predict (UC-4.5, UC-4.6, UC-4.7 E2) and model loading at startup."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from hougang.bootstrap import AppBootstrap
from hougang.errors import ModelUnavailableError


@pytest.fixture
def body(services):
    window = services["repository"].training_rows(24)
    town = Counter(r.town for r in window).most_common(1)[0][0]
    row = next(r for r in window if r.town == town and r.flat_type == "4 ROOM")
    return {"town": row.town, "flat_type": row.flat_type, "storey_range": row.storey_range,
            "flat_model": row.flat_model, "floor_area_sqm": row.floor_area_sqm,
            "lease_commence_date": row.lease_commence_date}


def test_uc45_predict_returns_price_and_breakdown(client, body):
    response = client.post("/api/predict", json=body)
    assert response.status_code == 200
    result = response.get_json()
    assert set(result) == {"estimated_price_sgd", "base_price_sgd", "reliability_warning", "breakdown_available",
                           "breakdown"}
    assert result["breakdown"][0] == {"feature_name": "Town", "input_value": body["town"],
                                      "contribution_sgd": result["breakdown"][0]["contribution_sgd"]}


def test_uc45_ex1_missing_fields_are_listed(client):
    response = client.post("/api/predict", json={"town": "BEDOK", "floor_area_sqm": "abc"})
    assert response.status_code == 400
    fields = response.get_json()["error"]["fields"]
    assert set(fields) == {"flat_type", "storey_range", "flat_model", "floor_area_sqm", "lease_commence_date"}


def test_uc45_body_must_be_json(client):
    response = client.post("/api/predict", data="town=BEDOK", content_type="text/plain")
    assert response.status_code == 400


def test_uc47_ex3_insufficient_data_is_422(client, body, services):
    window = services["repository"].training_rows(24)
    rare = next(v for v, n in Counter(r.storey_range for r in window).items() if n < 30)
    response = client.post("/api/predict", json={**body, "storey_range": rare})
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "insufficient_data"


def test_model_unavailable_is_503(client, body, services, monkeypatch):
    def unavailable(_inputs):
        raise ModelUnavailableError("No trained model is available yet.")

    monkeypatch.setattr(services["model"], "predict", unavailable)
    response = client.post("/api/predict", json=body)
    assert response.status_code == 503 and response.get_json()["error"]["code"] == "model_unavailable"


def test_startup_trains_a_model_when_none_is_saved(config):
    Path(config["MODEL_ARTEFACT_PATH"]).unlink()
    services = AppBootstrap(config).create_app().extensions["hougang"]
    assert Path(config["MODEL_ARTEFACT_PATH"]).exists()
    assert services["prediction_manager"].get_diagnostics().r_squared > 0


def test_startup_without_data_leaves_model_unavailable(empty_services):
    with pytest.raises(ModelUnavailableError):
        empty_services["prediction_manager"].get_diagnostics()


@pytest.mark.parametrize("value", ["inf", "Infinity", "1e400", "nan"])
def test_uc45_ex2_non_finite_numbers_are_field_errors(client, body, value):
    response = client.post("/api/predict", json={**body, "lease_commence_date": value, "floor_area_sqm": value})
    assert response.status_code == 400
    assert set(response.get_json()["error"]["fields"]) == {"lease_commence_date", "floor_area_sqm"}
