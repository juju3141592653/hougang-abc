"""Public Flask routes (UC-4.1 to UC-4.4, UC-4.7, UC-4.10 "last updated")."""

from __future__ import annotations

from collections import Counter

import pytest

from tests.conftest import fixture_rows


@pytest.fixture
def busy_town():
    return Counter(r["town"] for r in fixture_rows()).most_common(1)[0][0]


def test_uc41_filter_options(client, busy_town):
    towns = client.get("/api/filter-options").get_json()["towns"]
    assert busy_town in towns
    in_town = client.get("/api/filter-options", query_string={"town": busy_town}).get_json()
    assert in_town["flat_types"] and in_town["storey_ranges"] and in_town["floor_area_min"] > 0


def test_uc42_latest_returns_a_page_of_transactions(client, busy_town):
    response = client.get("/api/transactions/latest", query_string={"town": busy_town})
    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"records", "page", "page_size", "total", "total_pages"}
    record = body["records"][0]
    for field in ("id", "transaction_month", "town", "flat_type", "storey_range", "flat_model", "floor_area_sqm",
                  "lease_commence_date", "remaining_lease_years", "resale_price_sgd", "block", "street_name"):
        assert field in record  # SRS 4.2.3.2 fields on every listing entry


def test_uc47_e1_invalid_filters_return_field_errors(client):
    response = client.get("/api/transactions/latest", query_string={"town": "", "floor_area_sqm": "huge"})
    assert response.status_code == 400
    error = response.get_json()["error"]
    assert error["code"] == "validation_error"
    assert error["fields"] == {"floor_area_sqm": "Enter the floor area as a number of square metres."}
    response = client.get("/api/transactions/latest", query_string={"town": ""})
    assert response.get_json()["error"]["fields"] == {"town": "Select a town."}


def test_uc43_history_paging(client, busy_town):
    first = client.get("/api/transactions/history", query_string={"town": busy_town, "page": 1}).get_json()
    second = client.get("/api/transactions/history", query_string={"town": busy_town, "page": 2}).get_json()
    assert first["total"] == second["total"] and first["total_pages"] >= 2
    assert first["records"][0]["id"] != second["records"][0]["id"]
    bad = client.get("/api/transactions/history", query_string={"town": busy_town, "page": "x"})
    assert bad.status_code == 400


def test_uc42_transaction_details_and_404(client, busy_town):
    record = client.get("/api/transactions/latest", query_string={"town": busy_town}).get_json()["records"][0]
    details = client.get(f"/api/transactions/{record['id']}")
    assert details.status_code == 200 and details.get_json() == record
    missing = client.get("/api/transactions/99999999")
    assert missing.status_code == 404 and missing.get_json()["error"]["code"] == "not_found"


def test_uc44_summary(client, busy_town):
    body = client.get("/api/summary", query_string={"town": busy_town, "period": "3y"}).get_json()
    assert body["count"] > 0 and body["median_sgd"] > 0
    months = list(body["trend"])
    assert months == sorted(months)


def test_uc410_last_updated(client):
    body = client.get("/api/last-updated").get_json()
    raw = fixture_rows()
    assert body["latest_month"] == max(r["month"] for r in raw)
    assert body["last_successful_update"] is not None


def test_unknown_api_route_is_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404 and "error" in response.get_json()


def test_uc41_ex1_dataset_unavailable_is_503(tmp_path):
    from hougang.bootstrap import AppBootstrap
    from tests.conftest import make_config

    client = AppBootstrap(make_config(tmp_path)).create_app().test_client()
    response = client.get("/api/transactions/latest", query_string={"town": "BEDOK"})
    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "data_source_unavailable"


def test_uc41_filter_options_report_the_floor_area_tolerance(client):
    assert client.get("/api/filter-options").get_json()["floor_area_tolerance_sqm"] == 5.0


@pytest.mark.parametrize("value", ["inf", "-Infinity", "nan", "1e400"])
def test_uc47_non_finite_floor_area_is_a_field_error(client, busy_town, value):
    response = client.get("/api/transactions/latest", query_string={"town": busy_town, "floor_area_sqm": value})
    assert response.status_code == 400 and "floor_area_sqm" in response.get_json()["error"]["fields"]


def test_uc43_out_of_range_page_and_id(client, busy_town):
    page = client.get("/api/transactions/history", query_string={"town": busy_town, "page": 9223372036854775807})
    assert page.status_code == 400 and "page" in page.get_json()["error"]["fields"]
    assert client.get("/api/transactions/99999999999999999999").status_code == 404
