"""OLSRegressionModel (UC-4.5 prediction, UC-4.6 breakdown, UC-4.8 diagnostics)."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from hougang.adapters.ols_regression_model import OLSRegressionModel
from hougang.domain import PredictionInput
from hougang.errors import InsufficientDataError, ModelUnavailableError


@pytest.fixture(scope="module")
def training_rows(tmp_path_factory):
    from hougang.bootstrap import AppBootstrap
    from tests.conftest import FIXTURE_CSV, make_config
    from werkzeug.datastructures import FileStorage

    services = AppBootstrap(make_config(tmp_path_factory.mktemp("model"))).create_app().extensions["hougang"]
    with open(FIXTURE_CSV, "rb") as fh:
        services["dataset_manager"].import_file(FileStorage(stream=fh, filename="sample.csv"))
    return services["repository"].training_rows(24)


@pytest.fixture(scope="module")
def fitted(training_rows, tmp_path_factory):
    model = OLSRegressionModel(str(tmp_path_factory.mktemp("artefact") / "model.json"))
    model.fit(training_rows)
    return model


def as_input(row) -> PredictionInput:
    return PredictionInput(row.town, row.flat_type, row.storey_range, row.flat_model, row.floor_area_sqm,
                           row.lease_commence_date)


def test_uc45_predictions_match_an_independent_least_squares_fit(fitted, training_rows):
    frame = pd.DataFrame(
        [{"town": r.town, "flat_type": r.flat_type, "storey_range": r.storey_range, "flat_model": r.flat_model,
          "floor_area_sqm": r.floor_area_sqm, "lease_commence_date": r.lease_commence_date} for r in training_rows]
    )
    design = pd.get_dummies(frame, columns=["town", "flat_type", "storey_range", "flat_model"], dtype=float)
    design.insert(0, "const", 1.0)
    prices = np.array([r.resale_price_sgd for r in training_rows])
    beta, *_ = np.linalg.lstsq(design.to_numpy(), prices, rcond=None)
    expected = design.to_numpy() @ beta
    for i in range(0, len(training_rows), 97):
        assert fitted.predict(as_input(training_rows[i])) == pytest.approx(expected[i], abs=1.0)


def test_uc46_base_plus_contributions_equals_prediction(fitted, training_rows):
    mean_price = np.mean([r.resale_price_sgd for r in training_rows])
    for row in training_rows[::151]:
        inputs = as_input(row)
        breakdown = fitted.explain(inputs)
        assert [b.feature_name for b in breakdown] == [
            "Town", "Flat type", "Storey range", "Flat model", "Floor area", "Lease commencement year"
        ]
        # Base price = average training price (decisions #13).
        assert fitted.predict(inputs) - sum(b.contribution_sgd for b in breakdown) == pytest.approx(mean_price, abs=0.01)


def test_uc46_breakdown_shows_the_values_entered(fitted, training_rows):
    row = training_rows[0]
    values = {b.feature_name: b.input_value for b in fitted.explain(as_input(row))}
    assert values["Town"] == row.town and values["Floor area"] == f"{row.floor_area_sqm:g} sqm"
    assert values["Lease commencement year"] == str(row.lease_commence_date)


def test_uc46_bigger_flat_contributes_more_floor_area_value(fitted, training_rows):
    inputs = as_input(training_rows[0])
    small = {b.feature_name: b.contribution_sgd for b in fitted.explain(replace(inputs, floor_area_sqm=70))}
    large = {b.feature_name: b.contribution_sgd for b in fitted.explain(replace(inputs, floor_area_sqm=110))}
    assert large["Floor area"] > small["Floor area"]
    assert large["Town"] == pytest.approx(small["Town"])


def test_uc45_ac2_is_represented(fitted, training_rows):
    row = training_rows[0]
    assert fitted.is_represented(as_input(row))
    seen = {(r.town, r.flat_type, r.flat_model, r.storey_range) for r in training_rows}
    storeys = sorted({r.storey_range for r in training_rows})
    unseen = next(s for s in storeys if (row.town, row.flat_type, row.flat_model, s) not in seen)
    assert not fitted.is_represented(replace(as_input(row), storey_range=unseen))
    assert not fitted.is_represented(replace(as_input(row), floor_area_sqm=399))


def test_uc48_diagnostics(fitted):
    d = fitted.diagnostics()
    assert 0.6 < d.r_squared < 1 and d.adjusted_r_squared <= d.r_squared
    assert d.rmse_sgd > 0
    assert set(d.coefficients) == set(d.p_values)
    assert "Intercept" in d.coefficients and "Floor area (per sqm)" in d.coefficients
    assert all(0 <= p <= 1 for p in d.p_values.values())
    assert any(name.startswith("Town: ") and "(vs " in name for name in d.coefficients)


def test_identical_dummy_columns_are_dropped(fitted, training_rows):
    """MULTI-GENERATION flat type and 'Multi Generation' flat model are the same flats."""
    assert any(r.flat_type == "MULTI-GENERATION" for r in training_rows)
    names = fitted.diagnostics().coefficients
    assert "Flat type: MULTI-GENERATION (vs 4 ROOM)" in names
    assert not any(n.startswith("Flat model: Multi Generation") for n in names)
    row = next(r for r in training_rows if r.flat_type == "MULTI-GENERATION")
    assert np.isfinite(fitted.predict(as_input(row)))


def test_save_and_load_round_trip(fitted, training_rows, tmp_path):
    fitted.save()
    artefact = json.loads(open(fitted._artefact_path, encoding="utf-8").read())
    assert artefact["training"]["rows"] == len(training_rows)
    loaded = OLSRegressionModel(fitted._artefact_path)
    loaded.load()
    inputs = as_input(training_rows[3])
    assert loaded.predict(inputs) == pytest.approx(fitted.predict(inputs))
    assert loaded.explain(inputs) == fitted.explain(inputs)
    assert loaded.diagnostics() == fitted.diagnostics()


def test_uc48_ex1_missing_or_corrupt_artefact(tmp_path):
    model = OLSRegressionModel(str(tmp_path / "missing.json"))
    with pytest.raises(ModelUnavailableError):
        model.load()
    with pytest.raises(ModelUnavailableError):
        model.diagnostics()
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json")
    with pytest.raises(ModelUnavailableError):
        OLSRegressionModel(str(corrupt)).load()


def test_unknown_category_is_insufficient_data(fitted, training_rows):
    with pytest.raises(InsufficientDataError, match="no recent sales"):
        fitted.predict(replace(as_input(training_rows[0]), town="ATLANTIS"))


def test_fit_needs_enough_rows(training_rows, tmp_path):
    with pytest.raises(InsufficientDataError):
        OLSRegressionModel(str(tmp_path / "m.json")).fit(training_rows[:10])


def test_reference_levels_are_the_most_common(fitted, training_rows):
    common_type = Counter(r.flat_type for r in training_rows).most_common(1)[0][0]
    assert all(f"(vs {common_type})" in n for n in fitted.diagnostics().coefficients if n.startswith("Flat type: "))


def test_uc45_typical_error_grows_with_price_level(fitted, training_rows):
    bands = fitted._snapshot[0]["error_bands"]
    assert len(bands) == 10 and all(b["rmse"] > 0 for b in bands)
    cheap, dear = bands[0]["upper"] * 0.9, bands[-1]["upper"]
    assert fitted.typical_error(cheap) < fitted.typical_error(dear)
    assert fitted.typical_error(10**9) == bands[-1]["rmse"]


def test_uc45_typical_error_falls_back_to_overall_rmse_for_old_artefacts(fitted, tmp_path):
    import json as _json
    state = dict(fitted._snapshot[0]); state.pop("error_bands")
    path = tmp_path / "old.json"; path.write_text(_json.dumps(state))
    old = OLSRegressionModel(str(path)); old.load()
    assert old.typical_error(500_000) == state["diagnostics"]["rmse_sgd"]


def test_uc48_diagnostics_report_the_training_window(fitted, training_rows):
    d = fitted.diagnostics()
    assert d.n_observations == len(training_rows)
    assert d.training_from == min(r.transaction_month for r in training_rows)
    assert d.training_to == max(r.transaction_month for r in training_rows)
    assert d.fitted_at
