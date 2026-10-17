"""PredictionManager (UC-4.5, UC-4.6, UC-4.7 prediction validation, UC-4.8)."""

from __future__ import annotations

from collections import Counter
from dataclasses import replace
from itertools import product
from pathlib import Path

import pytest

from hougang.adapters.ols_regression_model import OLSRegressionModel
from hougang.controls.prediction_manager import RELIABILITY_WARNING, PredictionManager
from hougang.domain import PredictionInput
from hougang.errors import DataSourceError, InsufficientDataError, ModelUnavailableError, ValidationError


@pytest.fixture
def manager(services):
    return services["prediction_manager"]


@pytest.fixture
def window(services):
    return services["repository"].training_rows(24)


def common(window, field, minimum=30):
    return [v for v, n in Counter(getattr(r, field) for r in window).most_common() if n >= minimum]


def as_input(row) -> PredictionInput:
    return PredictionInput(row.town, row.flat_type, row.storey_range, row.flat_model, row.floor_area_sqm,
                           row.lease_commence_date)


@pytest.fixture
def typical(window):
    """A real recent sale whose four category values are all well supported."""
    supported = {f: set(common(window, f)) for f in ("town", "flat_type", "storey_range", "flat_model")}
    return as_input(next(r for r in window if all(getattr(r, f) in supported[f] for f in supported)))


def test_uc45_prediction_with_automatic_breakdown(manager, typical):
    result = manager.predict(typical)
    assert result.estimated_price_sgd > 0
    assert result.breakdown_available and len(result.breakdown) == 6
    assert result.reliability_warning is None
    # Prediction = base price + contributions, exactly (in cents).
    assert round(result.base_price_sgd + sum(b.contribution_sgd for b in result.breakdown), 2) == result.estimated_price_sgd


def test_uc45_ac2_unseen_combination_still_predicts_with_warning(manager, window):
    seen = {(r.town, r.flat_type, r.flat_model, r.storey_range) for r in window}
    combo = next(
        c for c in product(common(window, "town"), common(window, "flat_type"), common(window, "flat_model"),
                           common(window, "storey_range"))
        if c not in seen
    )
    result = manager.predict(PredictionInput(combo[0], combo[1], combo[3], combo[2], 95.0, 2000))
    assert result.reliability_warning == RELIABILITY_WARNING
    assert result.estimated_price_sgd > 0 and result.breakdown_available


def test_uc47_ex3_insufficient_supporting_data(manager, window, typical):
    rare_storey = next(v for v, n in Counter(r.storey_range for r in window).items() if n < 30)
    with pytest.raises(InsufficientDataError) as caught:
        manager.predict(replace(typical, storey_range=rare_storey))
    assert caught.value.details["min_samples"] == 30
    assert caught.value.details["supporting_sales"] < 30
    assert "at least 30" in caught.value.message


def test_uc47_min_samples_is_configurable(services, typical):
    strict = PredictionManager(services["model"], services["repository"], min_samples=10**6)
    with pytest.raises(InsufficientDataError):
        strict.predict(typical)


@pytest.mark.parametrize(
    "change, field",
    [({"town": "ATLANTIS"}, "town"), ({"flat_type": ""}, "flat_type"), ({"storey_range": "99 TO 99"}, "storey_range"),
     ({"flat_model": "Castle"}, "flat_model"), ({"floor_area_sqm": 2.0}, "floor_area_sqm"),
     ({"lease_commence_date": 2999}, "lease_commence_date"), ({"lease_commence_date": 1900}, "lease_commence_date")],
)
def test_uc45_ex2_invalid_inputs_are_rejected_per_field(manager, typical, change, field):
    with pytest.raises(ValidationError) as caught:
        manager.predict(replace(typical, **change))
    assert field in caught.value.fields


def test_uc46_ex1_breakdown_failure_still_returns_the_price(manager, services, typical, monkeypatch):
    def broken(_inputs):
        raise RuntimeError("coefficients corrupted")

    monkeypatch.setattr(services["model"], "explain", broken)
    result = manager.predict(typical)
    assert result.estimated_price_sgd > 0
    assert result.breakdown_available is False and result.breakdown == []


def test_uc48_diagnostics(manager):
    diagnostics = manager.get_diagnostics()
    assert 0 < diagnostics.r_squared < 1 and diagnostics.coefficients


def test_uc48_ex1_no_model(services, tmp_path, typical):
    manager = PredictionManager(OLSRegressionModel(str(tmp_path / "none.json")), services["repository"])
    with pytest.raises(ModelUnavailableError):
        manager.get_diagnostics()
    with pytest.raises(ModelUnavailableError):
        manager.predict(typical)


def test_uc45_no_dataset(empty_services, typical):
    with pytest.raises(DataSourceError):
        empty_services["prediction_manager"].predict(typical)


def test_retrain_saves_the_artefact(services, config):
    Path(config["MODEL_ARTEFACT_PATH"]).unlink()
    diagnostics = services["prediction_manager"].retrain()
    assert Path(config["MODEL_ARTEFACT_PATH"]).exists() and diagnostics.r_squared > 0


def test_concurrent_retrains_and_predictions_do_not_fail(services, config, typical):
    """Daily job, an upload and "Check data.gov.sg now" may retrain at the same time."""
    import json
    from concurrent.futures import ThreadPoolExecutor

    manager = services["prediction_manager"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = [pool.submit(manager.retrain) for _ in range(3)] + [pool.submit(manager.predict, typical) for _ in range(6)]
        results = [job.result() for job in jobs]  # re-raises any exception from a thread
    predictions = results[3:]
    assert all(round(p.base_price_sgd + sum(b.contribution_sgd for b in p.breakdown), 2) == p.estimated_price_sgd
               for p in predictions)
    assert json.loads(Path(config["MODEL_ARTEFACT_PATH"]).read_text())["version"] == 1
    assert not list(Path(config["MODEL_ARTEFACT_PATH"]).parent.glob("*.tmp"))
