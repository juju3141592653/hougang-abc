"""Public API (architecture: "Filter options / latest results / selected record details / history /
summary / predict"). Routes check request types, call the control classes and serialise results;
the controls own the business validation (docs/decisions.md #26).
"""

from __future__ import annotations

import math

from flask import Blueprint, current_app, jsonify, request

from hougang.domain import FilterCriteria, PredictionInput
from hougang.errors import NotFoundError, ValidationError
from hougang.routes.serializers import to_json

bp = Blueprint("public_api", __name__, url_prefix="/api")

MAX_PAGE = 1_000_000
MAX_ID = 2**63 - 1  # SQLite INTEGER range


def _service(name: str):
    return current_app.extensions["hougang"][name]


def _text(args, name: str) -> str | None:
    value = (args.get(name) or "").strip()
    return value or None


def _criteria_from_args(args) -> FilterCriteria:
    """Build FilterCriteria from query parameters (E1 for a non-numeric floor area)."""
    area_text = _text(args, "floor_area_sqm")
    area = None
    if area_text is not None:
        try:
            area = float(area_text)
            if not math.isfinite(area):
                raise ValueError(area_text)
        except ValueError:
            raise ValidationError(
                "Please correct the highlighted filters.",
                fields={"floor_area_sqm": "Enter the floor area as a number of square metres."},
            ) from None
    return FilterCriteria(
        town=_text(args, "town") or "",
        flat_type=_text(args, "flat_type"),
        storey_range=_text(args, "storey_range"),
        floor_area_sqm=area,
        flat_model=_text(args, "flat_model"),
    )


def _page_from_args(args) -> int:
    try:
        page = int(args.get("page", 1))
    except ValueError:
        raise ValidationError("Please correct the highlighted filters.", fields={"page": "Page must be a number."}) from None
    if not 1 <= page <= MAX_PAGE:
        raise ValidationError("Please correct the highlighted filters.",
                              fields={"page": f"Page must be between 1 and {MAX_PAGE:,}."})
    return page


@bp.get("/filter-options")
def filter_options():
    """UC-4.1: towns, and the flat types / storey ranges / flat models / floor areas in a town."""
    options = _service("search_manager").get_filter_options(_text(request.args, "town") or "")
    return jsonify({**options, "floor_area_tolerance_sqm": current_app.config["FLOOR_AREA_TOLERANCE_SQM"]})


@bp.get("/transactions/latest")
def latest_transactions():
    """UC-4.2: latest matching transactions (S2). A 400 here is E1 on S1."""
    page = _service("search_manager").latest(_criteria_from_args(request.args), _page_from_args(request.args))
    return jsonify(to_json(page))


@bp.get("/transactions/history")
def historical_transactions():
    """UC-4.3: all matching historical transactions (S3)."""
    page = _service("search_manager").history(_criteria_from_args(request.args), _page_from_args(request.args))
    return jsonify(to_json(page))


@bp.get("/transactions/<int:transaction_id>")
def transaction_details(transaction_id: int):
    """UC-4.2 AC.1: details of the selected record (S2a)."""
    if transaction_id > MAX_ID:
        raise NotFoundError("That transaction could not be found. It may have been selected from an old link.")
    return jsonify(to_json(_service("search_manager").get_details(transaction_id)))


@bp.get("/summary")
def summary_statistics():
    """UC-4.4: summary statistics and trend (S4)."""
    stats = _service("search_manager").summary(_criteria_from_args(request.args), _text(request.args, "period"))
    return jsonify(to_json(stats))


@bp.get("/last-updated")
def last_updated():
    """UC-4.10 step 5: the "data as of" line shown to end users."""
    status = _service("dataset_manager").get_status()
    return jsonify(
        {
            "first_month": status["first_month"],
            "latest_month": status["latest_month"],
            "last_successful_update": status["last_successful_update"],
        }
    )


@bp.post("/predict")
def predict():
    """UC-4.5 / UC-4.6: estimate plus automatic breakdown (S6). 400 / 422 are E2."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValidationError("Send the property features as a JSON object.")
    return jsonify(to_json(_service("prediction_manager").predict(_prediction_input(body))))


def _prediction_input(body: dict) -> PredictionInput:
    """Type-check the six features; missing or non-numeric values are reported per field (E2)."""
    errors: dict[str, str] = {}
    labels = {"town": "town", "flat_type": "flat type", "storey_range": "storey range", "flat_model": "flat model"}
    text: dict[str, str] = {}
    for field, label in labels.items():
        value = str(body.get(field) or "").strip()
        if not value:
            errors[field] = f"Select a {label}."
        text[field] = value
    area = _number(body.get("floor_area_sqm"))
    if area is None:
        errors["floor_area_sqm"] = "Enter the floor area as a number of square metres."
    lease = _number(body.get("lease_commence_date"))
    if lease is None or lease != int(lease):
        errors["lease_commence_date"] = "Enter the lease commencement year, e.g. 1995."
    if errors:
        raise ValidationError("Please complete or correct the highlighted fields.", fields=errors)
    return PredictionInput(floor_area_sqm=area, lease_commence_date=int(lease), **text)


def _number(value) -> float | None:
    if value is None or isinstance(value, bool) or str(value).strip() == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None
