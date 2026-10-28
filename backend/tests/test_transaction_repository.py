"""TransactionRepository (UC-4.1 to UC-4.5 reads; UC-4.9 / UC-4.10 writes)."""

from __future__ import annotations

import sqlite3
from collections import Counter
from dataclasses import replace

import pytest

from hougang.domain import FilterCriteria, PredictionInput
from hougang.months import shift_month
from tests.conftest import fixture_rows


@pytest.fixture
def repo(services):
    return services["repository"]


@pytest.fixture
def raw():
    return fixture_rows()


def test_uc42_recent_query_is_latest_12_months_newest_first(repo, raw):
    town = Counter(r["town"] for r in raw).most_common(1)[0][0]
    latest = max(r["month"] for r in raw)
    cutoff = shift_month(latest, -11)
    page = repo.query(FilterCriteria(town=town), page=1, recent=True)
    expected = [r for r in raw if r["town"] == town and r["month"] >= cutoff]
    assert page.total == len(expected)
    assert page.page == 1 and page.page_size == 24 and len(page.records) == 24
    months = [t.transaction_month for t in page.records]
    assert months == sorted(months, reverse=True)
    assert all(m >= cutoff for m in months)


def test_uc43_history_query_includes_older_records_and_pages(repo, raw):
    town = Counter(r["town"] for r in raw).most_common(1)[0][0]
    total = sum(1 for r in raw if r["town"] == town)
    first = repo.query(FilterCriteria(town=town), page=1, recent=False)
    second = repo.query(FilterCriteria(town=town), page=2, recent=False)
    assert first.total == second.total == total
    assert min(t.transaction_month for t in repo.all_matching(FilterCriteria(town=town))) < "2024-11"
    assert {t.id for t in first.records}.isdisjoint({t.id for t in second.records})
    assert first.records[-1].transaction_month >= second.records[0].transaction_month


def test_uc41_optional_filters_and_floor_area_tolerance(repo, raw):
    sample = next(r for r in raw if r["flat_type"] == "4 ROOM")
    criteria = FilterCriteria(
        town=sample["town"],
        flat_type="4 ROOM",
        storey_range=sample["storey_range"],
        flat_model=sample["flat_model"],
        floor_area_sqm=float(sample["floor_area_sqm"]),
    )
    results = repo.all_matching(criteria)
    expected = [
        r for r in raw
        if r["town"] == sample["town"] and r["flat_type"] == "4 ROOM" and r["storey_range"] == sample["storey_range"]
        and r["flat_model"] == sample["flat_model"]
        and abs(float(r["floor_area_sqm"]) - float(sample["floor_area_sqm"])) <= 5
    ]
    assert len(results) == len(expected) >= 1
    assert all(abs(t.floor_area_sqm - criteria.floor_area_sqm) <= 5 for t in results)


def test_all_matching_is_oldest_first(repo, raw):
    rows = repo.all_matching(FilterCriteria(town=raw[0]["town"]))
    months = [t.transaction_month for t in rows]
    assert months == sorted(months)


def test_uc42_find_by_id(repo, raw):
    record = repo.query(FilterCriteria(town=raw[0]["town"]), page=1, recent=False).records[0]
    assert repo.find_by_id(record.id) == record
    assert repo.find_by_id(10_000_000) is None


def test_uc47_count_supporting_is_smallest_category_count_in_window(repo, raw):
    latest = max(r["month"] for r in raw)
    window = [r for r in raw if r["month"] >= shift_month(latest, -23)]
    sample = window[0]
    inputs = PredictionInput(
        town=sample["town"], flat_type=sample["flat_type"], storey_range=sample["storey_range"],
        flat_model=sample["flat_model"], floor_area_sqm=90.0, lease_commence_date=2000,
    )
    expected = min(
        sum(1 for r in window if r[column] == sample[column])
        for column in ("town", "flat_type", "flat_model", "storey_range")
    )
    assert repo.count_supporting(inputs) == expected
    assert repo.count_supporting(replace(inputs, town="ATLANTIS")) == 0


def test_training_rows_cover_requested_months(repo, raw):
    latest = max(r["month"] for r in raw)
    rows = repo.training_rows(24)
    assert len(rows) == sum(1 for r in raw if r["month"] >= shift_month(latest, -23))
    assert repo.training_rows(1) and all(t.transaction_month == latest for t in repo.training_rows(1))


def test_uc41_distinct_values_overall_and_per_town(repo, raw):
    overall = repo.distinct_values(None)
    assert overall["towns"] == sorted({r["town"] for r in raw})
    assert set(overall["flat_models"]) == {r["flat_model"] for r in raw}
    storeys = overall["storey_ranges"]
    assert storeys == sorted(storeys, key=lambda s: int(s[:2]))
    town = raw[0]["town"]
    in_town = repo.distinct_values(town)
    assert set(in_town["flat_types"]) == {r["flat_type"] for r in raw if r["town"] == town}
    assert in_town["towns"] == overall["towns"]
    assert in_town["floor_area_min"] == min(float(r["floor_area_sqm"]) for r in raw if r["town"] == town)


def test_dataset_stats(repo, raw):
    stats = repo.dataset_stats()
    assert stats == {
        "total_rows": len(raw),
        "first_month": min(r["month"] for r in raw),
        "latest_month": max(r["month"] for r in raw),
    }


def test_uc49_append_new_skips_duplicates_but_keeps_genuine_repeats(repo, raw):
    town = raw[0]["town"]
    existing = repo.all_matching(FilterCriteria(town=town))[0]
    before = repo.dataset_stats()["total_rows"]
    # Same sale again: already stored once, so nothing is added.
    assert repo.append_new([replace(existing, id=None)]) == 0
    # Two identical sales in the input while one is stored: exactly one is new.
    assert repo.append_new([replace(existing, id=None), replace(existing, id=None)]) == 1
    assert repo.dataset_stats()["total_rows"] == before + 1


def test_nfr543_transactions_are_append_only(repo, config):
    conn = sqlite3.connect(config["DB_PATH"])
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("UPDATE transactions SET resale_price_sgd = 1")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("DELETE FROM transactions")
    conn.close()


def test_uc410_update_status_and_last_successful_update(repo):
    before = repo.get_last_successful_update()
    repo.record_update_status({"source": "api", "status": "failed", "message": "timeout",
                               "finished_at": "2030-01-01T00:00:00+00:00"})
    assert repo.get_last_successful_update() == before
    repo.record_update_status({"source": "api", "status": "success", "rows_added": 3,
                               "finished_at": "2030-01-02T00:00:00+00:00"})
    assert repo.get_last_successful_update().isoformat() == "2030-01-02T00:00:00+00:00"
    history = repo.get_update_history(2)
    assert [h["status"] for h in history] == ["success", "failed"]
    assert history[0]["rows_added"] == 3 and history[1]["message"] == "timeout"


def test_empty_database_queries(empty_services):
    repo = empty_services["repository"]
    assert repo.query(FilterCriteria(town="BEDOK"), page=1, recent=True).total == 0
    assert repo.training_rows(24) == []
    assert repo.get_last_successful_update() is None
    assert repo.dataset_stats()["total_rows"] == 0
