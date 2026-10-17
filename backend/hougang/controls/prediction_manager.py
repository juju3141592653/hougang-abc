"""<<control>> PredictionManager: validate inputs, check supporting data, coordinate the OLS prediction
and its breakdown, report diagnostics, retrain.

Implements UC-4.5 View Fair Price Prediction, UC-4.6 View Prediction Breakdown (included, automatic),
the prediction half of UC-4.7 Validate and Handle Error, and UC-4.8 View Model Diagnostics (the
route enforces admin access, UC-4.11).
"""

from __future__ import annotations

import logging
import threading
from datetime import date

from hougang.adapters.ols_regression_model import OLSRegressionModel
from hougang.adapters.transaction_repository import TransactionRepository
from hougang.domain import ModelDiagnostics, Prediction, PredictionBreakdown, PredictionInput
from hougang.errors import DataSourceError, InsufficientDataError, ValidationError

logger = logging.getLogger(__name__)

FLOOR_AREA_RANGE = (20.0, 400.0)
EARLIEST_LEASE_YEAR = 1960
RELIABILITY_WARNING = (
    "No flat with exactly this town, flat type, flat model and storey range (or this floor area or lease "
    "year for the flat type) was sold in the period the model was trained on, so this estimate is less "
    "reliable than usual."
)


class PredictionManager:
    """<<control>> Fair-price estimates (UC-4.5 to UC-4.8). `model`, `repository` and `min_samples`
    are the diagram's private attributes; `min_samples` is the configurable sufficiency threshold."""

    def __init__(
        self,
        model: OLSRegressionModel,
        repository: TransactionRepository,
        min_samples: int = 30,
        training_window_months: int = 24,
    ):
        self._model = model
        self._repository = repository
        self._min_samples = min_samples
        self._training_window_months = training_window_months
        # One lock for model use and retraining: two retrains never overlap, and a prediction's price,
        # warning and breakdown always come from the same fitted model.
        self._model_lock = threading.RLock()

    def validate_input(self, inputs: PredictionInput) -> None:
        """Check all six features (UC-4.5 EX.1/EX.2, UC-4.7 EX.1). Raises ValidationError per field (E2)."""
        known = self._repository.distinct_values(None)
        if not known["towns"]:
            raise DataSourceError("The housing dataset is not available right now. Please try again later.")
        errors: dict[str, str] = {}
        for field, key, label in (
            ("town", "towns", "town"),
            ("flat_type", "flat_types", "flat type"),
            ("storey_range", "storey_ranges", "storey range"),
            ("flat_model", "flat_models", "flat model"),
        ):
            value = getattr(inputs, field)
            if not value:
                errors[field] = f"Select a {label}."
            elif value not in known[key]:
                errors[field] = f"'{value}' is not a known {label}."
        if not FLOOR_AREA_RANGE[0] <= inputs.floor_area_sqm <= FLOOR_AREA_RANGE[1]:
            errors["floor_area_sqm"] = (
                f"Floor area must be between {FLOOR_AREA_RANGE[0]:g} and {FLOOR_AREA_RANGE[1]:g} square metres."
            )
        this_year = date.today().year
        if not EARLIEST_LEASE_YEAR <= inputs.lease_commence_date <= this_year:
            errors["lease_commence_date"] = f"Lease commencement year must be between {EARLIEST_LEASE_YEAR} and {this_year}."
        if errors:
            raise ValidationError("Please complete or correct the highlighted fields.", fields=errors)

    def predict(self, inputs: PredictionInput) -> Prediction:
        """Estimate the current fair price and its breakdown (UC-4.5, UC-4.6).

        - Too few supporting sales (< min_samples) -> InsufficientDataError, no price (E2, UC-4.7 EX.3).
        - Combination not seen in training -> price plus reliability warning (UC-4.5 AC.2).
        - Breakdown failure -> price without breakdown, breakdown_available False (UC-4.6 EX.1).
        """
        self.validate_input(inputs)
        supporting = self._repository.count_supporting(inputs)
        if supporting < self._min_samples:
            raise InsufficientDataError(
                f"There isn't enough recent sales data to estimate this flat reliably: only {supporting} sale(s) "
                f"in the last {self._training_window_months} months share one of its characteristics (at least "
                f"{self._min_samples} are needed). Try a more common flat model or storey range, or another town.",
                details={"supporting_sales": supporting, "min_samples": self._min_samples},
            )
        with self._model_lock:
            estimate = self._model.predict(inputs)
            if estimate <= 0:
                raise InsufficientDataError(
                    "These characteristics are too far from recent sales for the model to give a sensible "
                    "estimate. Please check the floor area and lease commencement year."
                )
            warning = None if self._model.is_represented(inputs) else RELIABILITY_WARNING
            estimate = round(estimate, 2)
            try:
                breakdown = self._model.explain(inputs)
            except Exception:  # UC-4.6 EX.1: show the price, explain that the breakdown is unavailable
                logger.exception("Prediction breakdown failed")
                # With no contributions to show, the base equals the estimate (base + nothing = estimate).
                return Prediction(estimated_price_sgd=estimate, base_price_sgd=estimate, reliability_warning=warning,
                                  breakdown_available=False, breakdown=[])
        breakdown = [
            PredictionBreakdown(item.feature_name, item.input_value, round(item.contribution_sgd, 2))
            for item in breakdown
        ]
        # Base is derived so that base + contributions equals the estimate exactly after rounding.
        base = round(estimate - sum(item.contribution_sgd for item in breakdown), 2)
        return Prediction(estimated_price_sgd=estimate, base_price_sgd=base, reliability_warning=warning,
                          breakdown_available=True, breakdown=breakdown)

    def get_diagnostics(self) -> ModelDiagnostics:
        """Goodness of fit, coefficients and significance (UC-4.8). Raises ModelUnavailableError (EX.1)."""
        with self._model_lock:
            return self._model.diagnostics()

    def retrain(self) -> ModelDiagnostics:
        """Refit the model on the most recent training window and save it (docs/decisions.md #14)."""
        rows = self._repository.training_rows(self._training_window_months)
        with self._model_lock:
            self._model.fit(rows)
            self._model.save()
            logger.info("Model retrained on %d transactions", len(rows))
            return self._model.diagnostics()
