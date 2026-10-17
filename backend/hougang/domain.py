"""Domain objects and collections from the design class diagram (Lab3, p.1).

Field names and types follow the diagram exactly. `Transaction.block` and `Transaction.street_name`
are the one approved addition (docs/decisions.md #16). These objects cross the HTTP API as JSON.
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

    `id` is None until the row has been stored by TransactionRepository.
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
    """<<value object>> Summary statistics and price trend (UC-4.4). `trend` maps YYYY-MM to the median price."""

    count: int
    mean_sgd: float
    median_sgd: float
    trend: dict[str, float]


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

    `breakdown_available` is False only on the breakdown error path (UC-4.6 EX.1).
    """

    estimated_price_sgd: float
    base_price_sgd: float
    reliability_warning: str | None
    breakdown_available: bool
    breakdown: list[PredictionBreakdown] = field(default_factory=list)


@dataclass(frozen=True)
class ModelDiagnostics:
    """<<value object>> Goodness of fit and coefficients of the fitted OLS model (UC-4.8, admin only)."""

    r_squared: float
    adjusted_r_squared: float
    rmse_sgd: float | None
    coefficients: dict[str, float]
    p_values: dict[str, float]
