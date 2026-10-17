"""DatasetManager.update_from_api() and get_status() (UC-4.10 Update Price Database)."""

from __future__ import annotations

import pytest

from hougang.controls.dataset_manager import DatasetManager
from hougang.errors import DataSourceError
from tests.conftest import fixture_rows


class FakeClient:
    def __init__(self, records=None, error=None):
        self.records = records or []
        self.error = error

    def fetch_records(self):
        if self.error:
            raise self.error
        return [dict(r) for r in self.records]


def api_records(rows):
    """Shape real rows like the API does: text values plus an _id."""
    return [{"_id": i, **r, "floor_area_sqm": f"{float(r['floor_area_sqm']):.2f}"} for i, r in enumerate(rows, 1)]


@pytest.fixture
def repo(empty_services):
    return empty_services["repository"]


def test_uc410_new_records_are_appended_and_reruns_add_nothing(repo):
    rows = fixture_rows()[:300]
    manager = DatasetManager(repo, FakeClient(api_records(rows)))
    first = manager.update_from_api()
    assert first["status"] == "success" and first["rows_added"] == 300 and first["rows_rejected"] == 0
    assert repo.get_last_successful_update() is not None  # UC-4.10 REQ-3
    second = manager.update_from_api()
    assert second["rows_added"] == 0 and second["duplicates_skipped"] == 300


def test_uc410_only_rows_not_already_stored_are_added(repo):
    rows = fixture_rows()[:200]
    DatasetManager(repo, FakeClient(api_records(rows[:150]))).update_from_api()
    summary = DatasetManager(repo, FakeClient(api_records(rows))).update_from_api()
    assert summary["rows_added"] == 50
    assert repo.dataset_stats()["total_rows"] == 200


def test_uc410_ex2_invalid_records_are_flagged_not_inserted(repo):
    records = api_records(fixture_rows()[:20])
    records[3]["resale_price"] = "n/a"  # deliberately invalid
    del records[7]["remaining_lease"]
    summary = DatasetManager(repo, FakeClient(records)).update_from_api()
    assert summary["rows_added"] == 18 and summary["rows_rejected"] == 2
    assert summary["rejected_reasons"][0].startswith("Record 4: resale_price")
    assert "missing fields remaining_lease" in summary["rejected_reasons"][1]


def test_uc410_ex1_api_failure_leaves_database_unchanged_and_flags_admin(repo):
    DatasetManager(repo, FakeClient(api_records(fixture_rows()[:10]))).update_from_api()
    before = repo.dataset_stats()
    manager = DatasetManager(repo, FakeClient(error=DataSourceError("data.gov.sg did not respond within 10 seconds.")))
    summary = manager.update_from_api()
    assert summary["status"] == "failed" and "10 seconds" in summary["message"]
    assert repo.dataset_stats() == before
    status = manager.get_status()
    assert status["needs_attention"][0]["status"] == "failed"  # UC-4.10 REQ-4: flagged for the admin


def test_uc410_get_status(repo):
    rows = fixture_rows()[:40]
    manager = DatasetManager(repo, FakeClient(api_records(rows)))
    manager.update_from_api()
    status = manager.get_status()
    assert status["total_rows"] == 40
    assert status["latest_month"] == max(r["month"] for r in rows)
    assert status["last_successful_update"]
    assert status["recent_updates"][0]["source"] == "api"
    assert status["needs_attention"] == []
