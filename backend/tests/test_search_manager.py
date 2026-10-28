"""SearchManager (UC-4.1 to UC-4.4, UC-4.7 filter validation)."""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import fmean, median

import pytest

from hougang.domain import FilterCriteria
from hougang.errors import DataSourceError, NotFoundError, ValidationError
from hougang.months import shift_month
from tests.conftest import fixture_rows


@pytest.fixture
def search(services):
    return services["search_manager"]


@pytest.fixture
def raw():
    return fixture_rows()


@pytest.fixture
def busy_town(raw):
    return Counter(r["town"] for r in raw).most_common(1)[0][0]


def test_uc41_valid_filters_pass(search, raw):
    row = raw[-1]
    search.validate_filters(
        FilterCriteria(town=row["town"], flat_type=row["flat_type"], storey_range=row["storey_range"],
                       flat_model=row["flat_model"], floor_area_sqm=float(row["floor_area_sqm"]))
    )


def test_uc47_ex1_every_invalid_filter_gets_its_own_message(search):
    with pytest.raises(ValidationError) as caught:
        search.validate_filters(
            FilterCriteria(town="ATLANTIS", flat_type="9 ROOM", storey_range="99 TO 99", flat_model="Castle",
                           floor_area_sqm=5000)
        )
    assert set(caught.value.fields) == {"town", "flat_type", "storey_range", "flat_model", "floor_area_sqm"}
    assert "ATLANTIS" in caught.value.fields["town"]


def test_uc41_town_is_required(search):
    with pytest.raises(ValidationError) as caught:
        search.latest(FilterCriteria(town=""), page=1)
    assert caught.value.fields == {"town": "Select a town."}


def test_uc41_ex1_dataset_unavailable(empty_services):
    with pytest.raises(DataSourceError, match="not available"):
        empty_services["search_manager"].latest(FilterCriteria(town="BEDOK"), page=1)


def test_uc41_filter_options_narrow_to_the_town(search, raw, busy_town):
    everything = search.get_filter_options("")
    in_town = search.get_filter_options(busy_town)
    assert busy_town in everything["towns"]
    assert set(in_town["flat_models"]) == {r["flat_model"] for r in raw if r["town"] == busy_town}
    assert set(in_town["flat_models"]) <= set(everything["flat_models"])
    with pytest.raises(ValidationError):
        search.get_filter_options("ATLANTIS")


def test_uc42_latest_is_recent_and_newest_first(search, raw, busy_town):
    page = search.latest(FilterCriteria(town=busy_town), page=1)
    cutoff = shift_month(max(r["month"] for r in raw), -11)
    assert page.total == sum(1 for r in raw if r["town"] == busy_town and r["month"] >= cutoff)
    assert [t.transaction_month for t in page.records] == sorted((t.transaction_month for t in page.records), reverse=True)


def test_uc42_ex1_no_recent_records_gives_empty_page(search, raw):
    # A real flat model that was sold in this town only before the recent window, if one exists.
    cutoff = shift_month(max(r["month"] for r in raw), -11)
    recent = {(r["town"], r["flat_model"]) for r in raw if r["month"] >= cutoff}
    old_only = next((r["town"], r["flat_model"]) for r in raw if (r["town"], r["flat_model"]) not in recent)
    criteria = FilterCriteria(town=old_only[0], flat_model=old_only[1])
    assert search.latest(criteria, page=1).total == 0
    assert search.history(criteria, page=1).total >= 1


def test_uc43_history_returns_all_years(search, raw, busy_town):
    page = search.history(FilterCriteria(town=busy_town), page=1)
    assert page.total == sum(1 for r in raw if r["town"] == busy_town)


def test_uc43_page_must_be_positive(search, busy_town):
    with pytest.raises(ValidationError) as caught:
        search.history(FilterCriteria(town=busy_town), page=0)
    assert "page" in caught.value.fields


def test_uc42_get_details(search, busy_town):
    record = search.latest(FilterCriteria(town=busy_town), page=1).records[0]
    assert search.get_details(record.id) == record
    with pytest.raises(NotFoundError):
        search.get_details(99_999_999)


@pytest.mark.parametrize("period, months", [("1y", 12), ("3y", 36), ("all", None), (None, None)])
def test_uc44_summary_statistics_match_the_data(search, raw, busy_town, period, months):
    rows = [r for r in raw if r["town"] == busy_town]
    if months:
        cutoff = shift_month(max(r["month"] for r in raw), -(months - 1))
        rows = [r for r in rows if r["month"] >= cutoff]
    prices = [float(r["resale_price"]) for r in rows]
    stats = search.summary(FilterCriteria(town=busy_town), period)
    assert stats.count == len(prices)
    assert stats.mean_sgd == pytest.approx(fmean(prices), abs=0.01)
    assert stats.median_sgd == pytest.approx(median(prices), abs=0.01)
    by_month = defaultdict(list)
    for r in rows:
        by_month[r["month"]].append(float(r["resale_price"]))
    assert list(stats.trend) == sorted(by_month)  # every point labelled with its month (SRS 4.4.3.3)
    assert stats.trend == {m: pytest.approx(median(v), abs=0.01) for m, v in by_month.items()}


def test_uc44_ex1_no_matching_records(search, raw):
    town = raw[0]["town"]
    stats = search.summary(FilterCriteria(town=town, floor_area_sqm=399), "all")
    assert stats.count == 0 and stats.trend == {}


def test_uc44_invalid_period(search, busy_town):
    with pytest.raises(ValidationError) as caught:
        search.summary(FilterCriteria(town=busy_town), "10y")
    assert "period" in caught.value.fields


def test_uc41_options_narrow_by_town_and_flat_type(search, raw, busy_town):
    """SRS 4.1 special requirement: options update based on the user's prior selections."""
    flat_type = Counter(r["flat_type"] for r in raw if r["town"] == busy_town).most_common(1)[0][0]
    narrowed = search.get_filter_options(busy_town, flat_type)
    rows = [r for r in raw if r["town"] == busy_town and r["flat_type"] == flat_type]
    assert set(narrowed["storey_ranges"]) == {r["storey_range"] for r in rows}
    assert set(narrowed["flat_models"]) == {r["flat_model"] for r in rows}
    assert narrowed["floor_area_min"] == min(float(r["floor_area_sqm"]) for r in rows)
    # Flat types stay the whole town's list so the user can switch type.
    assert set(narrowed["flat_types"]) == {r["flat_type"] for r in raw if r["town"] == busy_town}
    with pytest.raises(ValidationError) as caught:
        search.get_filter_options(busy_town, "9 ROOM")
    assert "flat_type" in caught.value.fields


def test_uc44_summary_reports_volume_and_price_per_sqm(search, raw, busy_town):
    rows = [r for r in raw if r["town"] == busy_town]
    stats = search.summary(FilterCriteria(town=busy_town), "all")
    assert sum(stats.volume.values()) == stats.count == len(rows)
    assert list(stats.volume) == list(stats.trend)
    assert stats.median_psm_sgd == pytest.approx(
        median(float(r["resale_price"]) / float(r["floor_area_sqm"]) for r in rows), abs=0.01)
