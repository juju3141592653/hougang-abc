"""<<external adapter>> DataGovClient: retrieve official HDB resale records from data.gov.sg, with
timeout handling and source validation (UC-4.10; NFR 5.1.2 "time out after 10 seconds").
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable

import requests

from hougang.errors import DataSourceError
from hougang.months import current_month, shift_month

DATASTORE_URL = "https://data.gov.sg/api/action/datastore_search"
EXPECTED_FIELDS = {
    "month", "town", "flat_type", "block", "street_name", "storey_range", "floor_area_sqm", "flat_model",
    "lease_commence_date", "remaining_lease", "resale_price",
}
RATE_LIMIT_RETRIES = 3
RATE_LIMIT_WAIT_SECONDS = 10


class DataGovClient:
    """<<external adapter>> Reads the HDB resale dataset from data.gov.sg (read-only).

    `dataset_id` and `timeout_seconds` (default 10) are the diagram's private attributes. Recent
    months are re-fetched on every run because late registrations keep arriving for them.
    """

    def __init__(
        self,
        dataset_id: str,
        timeout_seconds: int = 10,
        api_key: str | None = None,
        lookback_months: int = 3,
        session: requests.Session | None = None,
        page_size: int = 5000,
        sleep: Callable[[float], None] = time.sleep,
        month_provider: Callable[[], str] = current_month,
    ):
        self._dataset_id = dataset_id
        self._timeout_seconds = timeout_seconds
        self._api_key = api_key
        self._lookback_months = lookback_months
        self._session = session or requests.Session()
        self._page_size = page_size
        self._sleep = sleep
        self._month_provider = month_provider

    def fetch_records(self) -> list[dict]:
        """All records registered in the last `lookback_months` months (including the current one).

        Raises DataSourceError on timeout, network failure, rate limiting that doesn't clear, an
        error response, or a response that doesn't look like the HDB resale dataset.
        """
        this_month = self._month_provider()
        records: list[dict] = []
        for back in range(self._lookback_months):
            month = shift_month(this_month, -back)
            offset = 0
            while True:
                result = self._get(
                    {
                        "resource_id": self._dataset_id,
                        "limit": self._page_size,
                        "offset": offset,
                        "filters": json.dumps({"month": month}),
                    }
                )
                batch = result["records"]
                records.extend(batch)
                if len(batch) < self._page_size:
                    break
                offset += self._page_size
        return records

    # ------------------------------------------------------------------ private helpers

    def _get(self, params: dict) -> dict:
        headers = {"x-api-key": self._api_key} if self._api_key else {}
        for attempt in range(1, RATE_LIMIT_RETRIES + 2):
            try:
                response = self._session.get(DATASTORE_URL, params=params, headers=headers,
                                             timeout=self._timeout_seconds)
            except requests.Timeout:
                raise DataSourceError(
                    f"data.gov.sg did not respond within {self._timeout_seconds} seconds."
                ) from None
            except requests.RequestException as exc:
                raise DataSourceError(f"Could not reach data.gov.sg ({exc.__class__.__name__}).") from None
            try:
                body = response.json()
            except ValueError:
                body = {}
            if response.status_code == 429 or body.get("code") == 24:
                if attempt <= RATE_LIMIT_RETRIES:
                    self._sleep(self._retry_wait(response, attempt))
                continue
            if response.status_code != 200:
                raise DataSourceError(f"data.gov.sg returned HTTP {response.status_code}.")
            return self._validated(body)
        raise DataSourceError("data.gov.sg is rate-limiting requests; the update will be retried on the next run.")

    @staticmethod
    def _retry_wait(response, attempt: int) -> float:
        """Back-off: honour Retry-After when given, otherwise 10 s, 20 s, 30 s."""
        headers = getattr(response, "headers", None) or {}
        try:
            retry_after = headers.get("Retry-After")
            return max(1.0, float(retry_after))
        except (TypeError, ValueError):
            return RATE_LIMIT_WAIT_SECONDS * attempt

    @staticmethod
    def _validated(body: dict) -> dict:
        result = body.get("result") if isinstance(body, dict) else None
        if not body.get("success") or not isinstance(result, dict) or not isinstance(result.get("records"), list):
            raise DataSourceError("data.gov.sg returned an unexpected response.")
        fields = {f.get("id") for f in result.get("fields", []) if isinstance(f, dict)}
        if fields and not EXPECTED_FIELDS <= fields:
            missing = ", ".join(sorted(EXPECTED_FIELDS - fields))
            raise DataSourceError(f"The data.gov.sg dataset no longer has the expected columns (missing: {missing}).")
        return result
