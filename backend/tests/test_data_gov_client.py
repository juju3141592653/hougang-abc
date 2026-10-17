"""DataGovClient (UC-4.10; NFR 5.1.2 10-second timeout). HTTP is faked; payload rows are real."""

from __future__ import annotations

import json

import pytest
import requests

from hougang.adapters.data_gov_client import DATASTORE_URL, DataGovClient
from hougang.errors import DataSourceError
from tests.conftest import fixture_rows

FIELDS = [{"id": f} for f in ("_id", "month", "town", "flat_type", "block", "street_name", "storey_range",
                              "floor_area_sqm", "flat_model", "lease_commence_date", "remaining_lease", "resale_price")]


class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeSession:
    """Answers datastore_search calls from real fixture rows, filtered by month and paged."""

    def __init__(self, script=None):
        self.calls = []
        self.script = list(script or [])
        rows = fixture_rows()
        self.rows = [{"_id": i, **r} for i, r in enumerate(rows, start=1)]

    def get(self, url, params, headers, timeout):
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        if self.script:
            outcome = self.script.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            if outcome is not None:
                return outcome
        month = json.loads(params["filters"])["month"]
        matching = [r for r in self.rows if r["month"] == month]
        page = matching[params["offset"] : params["offset"] + params["limit"]]
        return FakeResponse(200, {"success": True, "result": {"fields": FIELDS, "records": page,
                                                              "total": len(matching)}})


def make_client(session, **kwargs):
    latest = max(r["month"] for r in fixture_rows())
    return DataGovClient("d_test", session=session, sleep=lambda s: None, month_provider=lambda: latest, **kwargs)


def test_uc410_fetches_each_recent_month_with_paging():
    session = FakeSession()
    records = make_client(session, lookback_months=3, page_size=50).fetch_records()
    raw = fixture_rows()
    months = sorted({r["month"] for r in raw})[-3:]
    assert len(records) == sum(1 for r in raw if r["month"] in months)
    asked = {json.loads(c["params"]["filters"])["month"] for c in session.calls}
    assert asked == set(months)
    assert any(c["params"]["offset"] > 0 for c in session.calls)  # paged
    assert all(c["url"] == DATASTORE_URL and c["params"]["resource_id"] == "d_test" for c in session.calls)


def test_nfr512_requests_use_a_10_second_timeout():
    session = FakeSession()
    make_client(session, lookback_months=1).fetch_records()
    assert {c["timeout"] for c in session.calls} == {10}


def test_uc410_ex1_timeout_raises_data_source_error():
    session = FakeSession(script=[requests.Timeout()])
    with pytest.raises(DataSourceError, match="within 10 seconds"):
        make_client(session).fetch_records()


def test_uc410_ex1_network_failure():
    session = FakeSession(script=[requests.ConnectionError("down")])
    with pytest.raises(DataSourceError, match="Could not reach"):
        make_client(session).fetch_records()


def test_uc410_ex1_rate_limit_is_retried_then_succeeds():
    waits = []
    session = FakeSession(script=[FakeResponse(429, {"code": 24}), FakeResponse(200, {"code": 24})])
    latest = max(r["month"] for r in fixture_rows())
    client = DataGovClient("d_test", session=session, sleep=waits.append, month_provider=lambda: latest,
                           lookback_months=1)
    assert client.fetch_records()
    assert waits == [10, 20]  # back-off grows


def test_uc410_rate_limit_honours_retry_after():
    waits = []
    limited = FakeResponse(429, None)
    limited.headers = {"Retry-After": "3"}
    session = FakeSession(script=[limited])
    latest = max(r["month"] for r in fixture_rows())
    DataGovClient("d_test", session=session, sleep=waits.append, month_provider=lambda: latest,
                  lookback_months=1).fetch_records()
    assert waits == [3.0]


def test_uc410_ex1_rate_limit_that_never_clears():
    session = FakeSession(script=[FakeResponse(429, None)] * 4)
    with pytest.raises(DataSourceError, match="rate-limiting"):
        make_client(session, lookback_months=1).fetch_records()


@pytest.mark.parametrize(
    "response, message",
    [
        (FakeResponse(500, None), "HTTP 500"),
        (FakeResponse(200, {"success": False}), "unexpected response"),
        (FakeResponse(200, {"success": True, "result": {"fields": [{"id": "month"}], "records": []}}),
         "expected columns"),
    ],
)
def test_uc410_source_validation(response, message):
    with pytest.raises(DataSourceError, match=message):
        make_client(FakeSession(script=[response]), lookback_months=1).fetch_records()


def test_api_key_is_sent_when_configured():
    session = FakeSession()
    make_client(session, lookback_months=1, api_key="k-123").fetch_records()
    assert session.calls[0]["headers"] == {"x-api-key": "k-123"}
