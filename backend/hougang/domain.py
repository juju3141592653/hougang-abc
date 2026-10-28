"""Domain objects and collections from the design class diagram (Lab3, p.1).

Field names and types follow the diagram exactly. Approved additions (docs/decisions.md) are marked
in each docstring. These objects cross the HTTP API as JSON.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FilterCriteria:
    """<<value object>> Housing filters selected on S1 (UC-4.1); reused by UC-4.2 to UC-4.4."""

    town: str
    flat_type: str | None = None
    storey_range: str | None = None
    floor_area_sqm: float | None = None
    flat_model: str | None = None


@dataclass(frozen=True)
class Transaction:
    """<<entity / persisted>> One HDB resale transaction (UC-4.2, UC-4.3, UC-4.9, UC-4.10).

    `id` is None until the row has been stored by TransactionRepository. Addition: `block`,
    `street_name` (decisions #16).
    """

    id: int | None
    transaction_month: str  # YYYY-MM (registration month)
    town: str
    flat_type: str
    storey_range: str
    flat_model: str
    floor_area_sqm: float
    lease_commence_date: int
    remaining_lease_years: float
    resale_price_sgd: float
    block: str = ""
    street_name: str = ""


@dataclass(frozen=True)
class TransactionPage:
    """<<container>> One page of transactions (UC-4.2 pagination, UC-4.3)."""

    records: list[Transaction]
    page: int
    page_size: int
    total: int


@dataclass(frozen=True)
class SummaryStatistics:
    """<<value object>> Summary statistics and price trend (UC-4.4).

    `trend` maps YYYY-MM to the median price. Additions (decisions #31): `volume` maps YYYY-MM to the
    number of sales behind that month's median; `median_psm_sgd` is the median price per sqm.
    """

    count: int
    mean_sgd: float
    median_sgd: float
    trend: dict[str, float]
    volume: dict[str, int] = field(default_factory=dict)
    median_psm_sgd: float = 0.0


@dataclass(frozen=True)
class PredictionInput:
    """<<value object>> The six property features entered on S5 (UC-4.5)."""

    town: str
    flat_type: str
    storey_range: str
    flat_model: str
    floor_area_sqm: float
    lease_commence_date: int


@dataclass(frozen=True)
class PredictionBreakdown:
    """<<entity>> Contribution of one input feature to the estimate, in SGD (UC-4.6)."""

    feature_name: str
    input_value: str
    contribution_sgd: float


@dataclass(frozen=True)
class Prediction:
    """<<entity>> Estimated price = base price + sum of breakdown contributions (UC-4.5, UC-4.6).

    `breakdown_available` is False only on the breakdown error path (UC-4.6 EX.1). Addition
    (decisions #29): `typical_error_sgd`, the model's typical error for flats at this price level, so
    the page can show a likely range (SRS 3.1 "±RMSE").
    """

    estimated_price_sgd: float
    base_price_sgd: float
    reliability_warning: str | None
    breakdown_available: bool
    breakdown: list[PredictionBreakdown] = field(default_factory=list)
    typical_error_sgd: float | None = None


@dataclass(frozen=True)
class ModelDiagnostics:
    """<<value object>> Goodness of fit and coefficients of the fitted OLS model (UC-4.8, admin only).

    Additions (decisions #30): what the model was trained on and when.
    """

    r_squared: float
    adjusted_r_squared: float
    rmse_sgd: float | None
    coefficients: dict[str, float]
    p_values: dict[str, float]
    n_observations: int = 0
    training_from: str | None = None
    training_to: str | None = None
    fitted_at: str | None = None
