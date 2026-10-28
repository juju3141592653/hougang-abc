"""<<control>> SearchManager: validate filters, retrieve details, latest / historical records, statistics.

Implements UC-4.1 Select Housing Filters, UC-4.2 View Latest Price, UC-4.3 View Historical Data,
UC-4.4 View Summary Statistics, and the filter half of UC-4.7 Validate and Handle Error.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import fmean, median

from hougang.adapters.transaction_repository import TransactionRepository
from hougang.domain import FilterCriteria, SummaryStatistics, Transaction, TransactionPage
from hougang.errors import DataSourceError, NotFoundError, ValidationError
from hougang.months import shift_month

# Summary periods (docs/decisions.md #19): label -> number of months, None = all data.
PERIODS = {"1y": 12, "3y": 36, "5y": 60, "all": None}
FLOOR_AREA_RANGE = (20.0, 400.0)


class SearchManager:
    """<<control>> Search and statistics over stored transactions (UC-4.1 to UC-4.4, UC-4.7)."""

    def __init__(self, repository: TransactionRepository):
        self._repository = repository

    def validate_filters(self, criteria: FilterCriteria) -> None:
        """Reject invalid filter values before any query runs (UC-4.7 EX.1, SRS 4.7.3.1).

        Raises ValidationError with one message per bad field (E1), or DataSourceError when the
        dataset is not available (UC-4.1 EX.1).
        """
        known = self._known_values()
        errors: dict[str, str] = {}
        if not criteria.town:
            errors["town"] = "Select a town."
        elif criteria.town not in known["towns"]:
            errors["town"] = f"'{criteria.town}' is not an HDB town in the dataset."
        for field, key, label in (
            ("flat_type", "flat_types", "flat type"),
            ("storey_range", "storey_ranges", "storey range"),
            ("flat_model", "flat_models", "flat model"),
        ):
            value = getattr(criteria, field)
            if value and value not in known[key]:
                errors[field] = f"'{value}' is not a known {label}."
        area = criteria.floor_area_sqm
        if area is not None and not FLOOR_AREA_RANGE[0] <= area <= FLOOR_AREA_RANGE[1]:
            errors["floor_area_sqm"] = (
                f"Floor area must be between {FLOOR_AREA_RANGE[0]:g} and {FLOOR_AREA_RANGE[1]:g} square metres."
            )
        if errors:
            raise ValidationError("Please correct the highlighted filters.", fields=errors)

    def get_details(self, id: int) -> Transaction:  # noqa: A002 - name from the class diagram
        """Full details of one transaction (UC-4.2 AC.1, S2a)."""
        record = self._repository.find_by_id(id)
        if record is None:
            raise NotFoundError("That transaction could not be found. It may have been selected from an old link.")
        return record

    def get_filter_options(self, town: str, flat_type: str | None = None) -> dict:
        """Dropdown values (UC-4.1 steps 2-5; SRS "options update based on the user's prior selections").

        A town narrows the flat types; a town plus flat type also narrows the storey ranges, flat
        models and floor-area range, so every combination offered has sales behind it (decisions #27).
        """
        known = self._known_values()
        errors = {}
        if town and town not in known["towns"]:
            errors["town"] = f"'{town}' is not an HDB town in the dataset."
        if flat_type and flat_type not in known["flat_types"]:
            errors["flat_type"] = f"'{flat_type}' is not a known flat type."
        if errors:
            raise ValidationError("Please correct the highlighted filters.", fields=errors)
        return self._repository.distinct_values(town or None, flat_type if town else None)

    def latest(self, criteria: FilterCriteria, page: int) -> TransactionPage:
        """Most recent matching transactions, newest first (UC-4.2)."""
        self.validate_filters(criteria)
        return self._repository.query(criteria, self._check_page(page), recent=True)

    def history(self, criteria: FilterCriteria, page: int) -> TransactionPage:
        """All matching historical transactions, newest first (UC-4.3)."""
        self.validate_filters(criteria)
        return self._repository.query(criteria, self._check_page(page), recent=False)

    def summary(self, criteria: FilterCriteria, period: str | None) -> SummaryStatistics:
        """Count, mean, median and monthly median trend for the period (UC-4.4).

        `period` is one of 1y, 3y, 5y, all (default all), counted back from the newest month in the
        dataset. No matching records gives count 0 and an empty trend (UC-4.4 EX.1 no-data message).
        """
        self.validate_filters(criteria)
        period = period or "all"
        if period not in PERIODS:
            raise ValidationError("Please correct the highlighted filters.",
                                  fields={"period": "Choose a period of 1y, 3y, 5y or all."})
        rows = self._repository.all_matching(criteria)
        months = PERIODS[period]
        latest = self._repository.dataset_stats()["latest_month"]
        if months and latest:
            cutoff = shift_month(latest, -(months - 1))
            rows = [r for r in rows if r.transaction_month >= cutoff]
        if not rows:
            return SummaryStatistics(count=0, mean_sgd=0.0, median_sgd=0.0, trend={})
        prices = [r.resale_price_sgd for r in rows]
        by_month: dict[str, list[float]] = defaultdict(list)
        for r in rows:
            by_month[r.transaction_month].append(r.resale_price_sgd)
        months_sorted = sorted(by_month)
        return SummaryStatistics(
            count=len(prices),
            mean_sgd=round(fmean(prices), 2),
            median_sgd=round(median(prices), 2),
            trend={month: round(median(by_month[month]), 2) for month in months_sorted},
            volume={month: len(by_month[month]) for month in months_sorted},
            median_psm_sgd=round(median(r.resale_price_sgd / r.floor_area_sqm for r in rows), 2),
        )

    # ------------------------------------------------------------------ private helpers

    def _known_values(self) -> dict:
        known = self._repository.distinct_values(None)
        if not known["towns"]:
            raise DataSourceError("The housing dataset is not available right now. Please try again later.")
        return known

    @staticmethod
    def _check_page(page: int) -> int:
        if page < 1:
            raise ValidationError("Please correct the highlighted filters.", fields={"page": "Page must be 1 or more."})
        return page
