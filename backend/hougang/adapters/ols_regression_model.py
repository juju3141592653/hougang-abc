"""<<model>> OLSRegressionModel: encode inputs, estimate the current fair price, feature contributions
and model diagnostics (UC-4.5, UC-4.6, UC-4.8).

Ordinary least squares multiple linear regression only (SRS 2.5), fitted with statsmodels:

    price = intercept + Σ β_town·[town] + Σ β_type·[flat type] + Σ β_model·[flat model]
                      + Σ β_storey·[storey range] + β_area·floor_area_sqm + β_lease·lease_commence_date

Categories are one-hot encoded with the most frequent level as the dropped reference (SRS 2.2).
`remaining_lease` is deliberately not a feature: within the recent training window it is almost
perfectly collinear with the lease commencement year (SRS 2.5; docs/decisions.md #12).

Breakdown (decisions #13): with an intercept, OLS predicts the mean price at the feature means, so
    estimate = base + Σ_features Σ_columns β·(x − mean),   base = mean training price,
and each feature's contribution reads "compared with an average recently sold flat".

The artefact (JSON, no pickle) stores the coefficients, the encoder (levels, reference levels,
column means), what the training data covered, and the statistical diagnostics.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import statsmodels.api as sm

from hougang.domain import ModelDiagnostics, PredictionBreakdown, PredictionInput, Transaction
from hougang.errors import InsufficientDataError, ModelUnavailableError

CATEGORICAL = ("town", "flat_type", "storey_range", "flat_model")
NUMERIC = ("floor_area_sqm", "lease_commence_date")
FEATURES = ("town", "flat_type", "storey_range", "flat_model", "floor_area_sqm", "lease_commence_date")
FEATURE_LABELS = {
    "town": "Town",
    "flat_type": "Flat type",
    "storey_range": "Storey range",
    "flat_model": "Flat model",
    "floor_area_sqm": "Floor area",
    "lease_commence_date": "Lease commencement year",
}
ARTEFACT_VERSION = 1
MIN_TRAINING_ROWS = 200
ERROR_BANDS = 10  # residual spread is measured separately for each tenth of the predicted-price range


def _column(feature: str, level: str | None = None) -> str:
    return f"{feature}={level}" if level is not None else feature


def _combination(town: str, flat_type: str, flat_model: str, storey_range: str) -> str:
    return "|".join((town, flat_type, flat_model, storey_range))


class OLSRegressionModel:
    """<<model>> Fitted OLS model plus its encoder. `artefact_path`, `coefficients` and `intercept`
    are the diagram's private attributes. The full fitted state is held in one snapshot that is
    swapped in a single assignment; PredictionManager serialises retraining against predictions so a
    request never mixes two models."""

    def __init__(self, artefact_path: str):
        self._artefact_path = artefact_path
        self._coefficients: dict[str, float] = {}
        self._intercept: float = 0.0
        self._snapshot: tuple[dict, frozenset[str]] | None = None

    # ------------------------------------------------------------------ persistence

    def load(self) -> None:
        """Load the saved artefact. Raises ModelUnavailableError if it is missing or unreadable."""
        path = Path(self._artefact_path)
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            if state.get("version") != ARTEFACT_VERSION:
                raise ValueError(f"artefact version {state.get('version')!r}")
            for key in ("intercept", "coefficients", "columns", "means", "levels", "represented", "ranges",
                        "diagnostics"):
                state[key]  # noqa: B018 - presence check
        except FileNotFoundError:
            raise ModelUnavailableError("No trained model is available yet.") from None
        except (ValueError, KeyError, TypeError) as exc:
            raise ModelUnavailableError(f"The saved model could not be read ({exc}).") from None
        self._install(state)

    def save(self) -> None:
        """Write the artefact atomically (unique temporary file in the same folder, then rename)."""
        state, _ = self._require_snapshot()
        path = Path(self._artefact_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name, suffix=".tmp",
                                         delete=False) as tmp:
            tmp.write(json.dumps(state, indent=1))
        os.replace(tmp.name, path)

    # ------------------------------------------------------------------ training

    def fit(self, rows: list[Transaction]) -> None:
        """Fit OLS on the given transactions and replace the current model in memory."""
        if len(rows) < MIN_TRAINING_ROWS:
            raise InsufficientDataError(
                f"At least {MIN_TRAINING_ROWS} transactions are needed to train the model; {len(rows)} were given."
            )
        levels: dict[str, list[str]] = {}
        reference: dict[str, str] = {}
        for feature in CATEGORICAL:
            counts = Counter(getattr(r, feature) for r in rows)
            levels[feature] = sorted(counts)
            reference[feature] = max(sorted(counts), key=lambda level: counts[level])

        candidate_columns = [
            _column(f, level) for f in CATEGORICAL for level in levels[f] if level != reference[f]
        ] + list(NUMERIC)
        matrix = self._design_matrix(rows, candidate_columns)
        # Drop dummy columns identical to an earlier one (e.g. flat type MULTI-GENERATION is
        # exactly flat model "Multi Generation"); keeping both makes the design matrix singular.
        columns, keep, seen = [], [], set()
        for index, name in enumerate(candidate_columns):
            signature = matrix[:, index].tobytes()
            if signature in seen:
                continue
            seen.add(signature)
            columns.append(name)
            keep.append(index)
        matrix = matrix[:, keep]

        prices = np.array([r.resale_price_sgd for r in rows], dtype=float)
        result = sm.OLS(prices, sm.add_constant(matrix, has_constant="add")).fit()
        params = np.asarray(result.params)
        p_values = np.asarray(result.pvalues)

        labels = {"const": "Intercept"}
        for name in columns:
            if name in NUMERIC:
                unit = "per sqm" if name == "floor_area_sqm" else "per year"
                labels[name] = f"{FEATURE_LABELS[name]} ({unit})"
            else:
                feature, level = name.split("=", 1)
                labels[name] = f"{FEATURE_LABELS[feature]}: {level} (vs {reference[feature]})"

        months = sorted({r.transaction_month for r in rows})
        ranges: dict[str, dict[str, float]] = {}
        for r in rows:
            entry = ranges.setdefault(
                r.flat_type,
                {"area_min": r.floor_area_sqm, "area_max": r.floor_area_sqm,
                 "lease_min": r.lease_commence_date, "lease_max": r.lease_commence_date},
            )
            entry["area_min"] = min(entry["area_min"], r.floor_area_sqm)
            entry["area_max"] = max(entry["area_max"], r.floor_area_sqm)
            entry["lease_min"] = min(entry["lease_min"], r.lease_commence_date)
            entry["lease_max"] = max(entry["lease_max"], r.lease_commence_date)

        residuals = np.asarray(result.resid)
        fitted = np.asarray(result.fittedvalues)
        # Residuals grow with price, so one global RMSE overstates the error for cheap flats and
        # understates it for expensive ones. Record the RMSE within each band of predicted price.
        edges = np.quantile(fitted, np.linspace(0, 1, ERROR_BANDS + 1))
        bands = []
        for low, high in zip(edges[:-1], edges[1:]):
            mask = (fitted >= low) & (fitted <= high)
            bands.append({"upper": float(high), "rmse": float(math.sqrt(np.mean(residuals[mask] ** 2)))})
        state = {
            "version": ARTEFACT_VERSION,
            "fitted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "training": {"rows": len(rows), "first_month": months[0], "last_month": months[-1]},
            "intercept": float(params[0]),
            "coefficients": {name: float(beta) for name, beta in zip(columns, params[1:])},
            "columns": columns,
            "means": {name: float(mean) for name, mean in zip(columns, matrix.mean(axis=0))},
            "base_price": float(prices.mean()),
            "levels": levels,
            "reference": reference,
            "labels": labels,
            "represented": sorted(
                {_combination(r.town, r.flat_type, r.flat_model, r.storey_range) for r in rows}
            ),
            "ranges": ranges,
            "error_bands": bands,
            "diagnostics": {
                "r_squared": float(result.rsquared),
                "adjusted_r_squared": float(result.rsquared_adj),
                "rmse_sgd": float(math.sqrt(np.mean(residuals**2))),
                "coefficients": {labels["const"]: float(params[0]),
                                 **{labels[n]: float(b) for n, b in zip(columns, params[1:])}},
                "p_values": {labels["const"]: self._clean(p_values[0]),
                             **{labels[n]: self._clean(p) for n, p in zip(columns, p_values[1:])}},
            },
        }
        self._install(state)

    # ------------------------------------------------------------------ inference

    def predict(self, inputs: PredictionInput) -> float:
        """Estimated price in SGD: x · β (SRS 2.5 "deterministic inference")."""
        state, _ = self._require_snapshot()
        x = self._encode(state, inputs)
        return state["intercept"] + sum(state["coefficients"][c] * x[c] for c in state["columns"])

    def explain(self, inputs: PredictionInput) -> list[PredictionBreakdown]:
        """Contribution of each of the six inputs, relative to an average training flat (UC-4.6)."""
        state, _ = self._require_snapshot()
        x = self._encode(state, inputs)
        contributions = dict.fromkeys(FEATURES, 0.0)
        for column in state["columns"]:
            feature = column.split("=", 1)[0]
            contributions[feature] += state["coefficients"][column] * (x[column] - state["means"][column])
        values = {
            "town": inputs.town,
            "flat_type": inputs.flat_type,
            "storey_range": inputs.storey_range,
            "flat_model": inputs.flat_model,
            "floor_area_sqm": f"{inputs.floor_area_sqm:g} sqm",
            "lease_commence_date": str(inputs.lease_commence_date),
        }
        return [
            PredictionBreakdown(feature_name=FEATURE_LABELS[f], input_value=values[f], contribution_sgd=contributions[f])
            for f in FEATURES
        ]

    def is_represented(self, inputs: PredictionInput) -> bool:
        """False when this category combination, or this size / lease year for the flat type, was not
        seen in training (UC-4.5 AC.2: still predict, but warn)."""
        state, represented = self._require_snapshot()
        combination = _combination(inputs.town, inputs.flat_type, inputs.flat_model, inputs.storey_range)
        if combination not in represented:
            return False
        span = state["ranges"].get(inputs.flat_type)
        return bool(
            span
            and span["area_min"] <= inputs.floor_area_sqm <= span["area_max"]
            and span["lease_min"] <= inputs.lease_commence_date <= span["lease_max"]
        )

    def typical_error(self, estimate: float) -> float:
        """Typical error (RMSE) of the model for flats predicted at about this price (decisions #29).

        About two in three training sales at this price level were within this amount of the
        model's estimate. Falls back to the overall RMSE for artefacts saved without bands.
        """
        state, _ = self._require_snapshot()
        bands = state.get("error_bands")
        if not bands:
            return state["diagnostics"]["rmse_sgd"]
        for band in bands:
            if estimate <= band["upper"]:
                return band["rmse"]
        return bands[-1]["rmse"]

    def diagnostics(self) -> ModelDiagnostics:
        """R², adjusted R², in-sample RMSE, coefficients and p-values, plus what the model was
        trained on and when (UC-4.8)."""
        state = self._require_snapshot()[0]
        d, training = state["diagnostics"], state.get("training", {})
        return ModelDiagnostics(
            r_squared=d["r_squared"],
            adjusted_r_squared=d["adjusted_r_squared"],
            rmse_sgd=d["rmse_sgd"],
            coefficients=dict(d["coefficients"]),
            p_values=dict(d["p_values"]),
            n_observations=training.get("rows", 0),
            training_from=training.get("first_month"),
            training_to=training.get("last_month"),
            fitted_at=state.get("fitted_at"),
        )

    # ------------------------------------------------------------------ private helpers

    def _install(self, state: dict) -> None:
        self._snapshot = (state, frozenset(state["represented"]))
        self._coefficients = state["coefficients"]
        self._intercept = state["intercept"]

    def _require_snapshot(self) -> tuple[dict, frozenset[str]]:
        snapshot = self._snapshot
        if snapshot is None:
            raise ModelUnavailableError("No trained model is available yet.")
        return snapshot

    @staticmethod
    def _encode(state: dict, inputs: PredictionInput) -> dict[str, float]:
        for feature in CATEGORICAL:
            value = getattr(inputs, feature)
            if value not in state["levels"][feature]:
                raise InsufficientDataError(
                    f"There are no recent sales with {FEATURE_LABELS[feature].lower()} '{value}', "
                    "so the model cannot estimate this flat."
                )
        x = {c: 0.0 for c in state["columns"]}
        for feature in CATEGORICAL:
            column = _column(feature, getattr(inputs, feature))
            if column in x:
                x[column] = 1.0
        x["floor_area_sqm"] = float(inputs.floor_area_sqm)
        x["lease_commence_date"] = float(inputs.lease_commence_date)
        return x

    @staticmethod
    def _design_matrix(rows: list[Transaction], columns: list[str]) -> np.ndarray:
        index = {name: i for i, name in enumerate(columns)}
        matrix = np.zeros((len(rows), len(columns)))
        for i, r in enumerate(rows):
            for feature in CATEGORICAL:
                j = index.get(_column(feature, getattr(r, feature)))
                if j is not None:
                    matrix[i, j] = 1.0
            matrix[i, index["floor_area_sqm"]] = r.floor_area_sqm
            matrix[i, index["lease_commence_date"]] = r.lease_commence_date
        return matrix

    @staticmethod
    def _clean(value: float) -> float:
        return float(value) if math.isfinite(value) else 1.0
