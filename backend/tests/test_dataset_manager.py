"""DatasetManager file import (UC-4.9). The API update (UC-4.10) is in test_dataset_update.py."""

from __future__ import annotations

import io

import pandas as pd
import pytest

from hougang.errors import ValidationError
from tests.conftest import file_upload, fixture_rows, rows_to_csv


@pytest.fixture
def manager(empty_services):
    return empty_services["dataset_manager"]


@pytest.mark.parametrize(
    "text, years",
    [("61 years 04 months", 61.3333), ("61 years", 61.0), ("95 years 11 months", 95.9167), ("1 year 1 month", 1.0833),
     ("61", 61.0), (" 70 YEARS 02 MONTHS ", 70.1667)],
)
def test_uc49_parse_remaining_lease(manager, text, years):
    assert manager.parse_remaining_lease(text) == pytest.approx(years, abs=1e-4)


@pytest.mark.parametrize("text", ["", "abc", "61 years 13 months", "120", "-3", "sixty years"])
def test_uc49_parse_remaining_lease_rejects_bad_text(manager, text):
    with pytest.raises(ValueError):
        manager.parse_remaining_lease(text)


def test_uc49_import_real_sample_then_reimport_adds_nothing(manager, empty_services):
    raw = fixture_rows()
    summary = manager.import_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert summary["status"] == "success"
    assert summary["rows_received"] == summary["rows_added"] == len(raw)
    assert summary["accepted_columns"][0] == "month" and summary["ignored_columns"] == []
    again = manager.import_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert again["rows_added"] == 0 and again["duplicates_skipped"] == len(raw)
    assert empty_services["repository"].get_last_successful_update() is not None


def test_uc49_validate_file_returns_parsed_transactions(manager):
    raw = fixture_rows()[:3]
    rows = manager.validate_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert [r.resale_price_sgd for r in rows] == [float(r["resale_price"]) for r in raw]
    assert rows[0].remaining_lease_years == manager.parse_remaining_lease(raw[0]["remaining_lease"])
    assert rows[0].id is None


def test_uc49_xlsx_is_accepted(manager):
    raw = fixture_rows()[:50]
    buffer = io.BytesIO()
    frame = pd.DataFrame(raw)
    for column in ("floor_area_sqm", "resale_price"):
        frame[column] = frame[column].astype(float)  # Excel users have real numbers in cells
    frame["lease_commence_date"] = frame["lease_commence_date"].astype(int)
    frame.to_excel(buffer, index=False)
    summary = manager.import_file(file_upload(buffer.getvalue(), "resale.xlsx"))
    assert summary["rows_added"] == 50


def test_uc49_ex1_wrong_format_is_rejected(manager):
    with pytest.raises(ValidationError, match=r"\.csv or \.xlsx"):
        manager.import_file(file_upload(b"month,town\n", "resale.txt"))


def test_uc49_ex2_missing_columns_are_listed(manager):
    raw = [{k: v for k, v in r.items() if k not in ("flat_model", "remaining_lease")} for r in fixture_rows()[:5]]
    with pytest.raises(ValidationError) as caught:
        manager.import_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert caught.value.details["missing_columns"] == ["flat_model", "remaining_lease"]
    assert "flat_model, remaining_lease" in caught.value.message


def test_uc49_ex3_file_without_data_rows_is_rejected(manager):
    header_only = rows_to_csv(fixture_rows()[:1]).split(b"\n")[0] + b"\n"
    with pytest.raises(ValidationError, match="no data rows"):
        manager.import_file(file_upload(header_only, "resale.csv"))
    with pytest.raises(ValidationError, match="empty"):
        manager.import_file(file_upload(b"", "resale.csv"))


def test_uc49_invalid_values_reject_the_whole_file_and_name_rows(manager, empty_services):
    raw = fixture_rows()[:10]
    # Deliberately invalid hand-edited values (allowed by CLAUDE.md for invalid-input tests).
    raw[2] = {**raw[2], "floor_area_sqm": "big"}
    raw[5] = {**raw[5], "remaining_lease": "forever"}
    with pytest.raises(ValidationError) as caught:
        manager.import_file(file_upload(rows_to_csv(raw), "resale.csv"))
    errors = caught.value.details["row_errors"]
    assert caught.value.details["invalid_row_count"] == 2
    assert errors[0].startswith("Row 4: floor_area_sqm 'big'") and errors[1].startswith("Row 7: remaining_lease")
    assert empty_services["repository"].dataset_stats()["total_rows"] == 0
    assert empty_services["repository"].get_update_history(1)[0]["status"] == "rejected"


def test_uc49_ac1_extra_columns_are_ignored_and_reported(manager):
    raw = [{**r, "notes": "x", "_id": "1"} for r in fixture_rows()[:5]]
    summary = manager.import_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert summary["rows_added"] == 5
    assert summary["ignored_columns"] == ["notes", "_id"]


def test_uc49_file_size_limit(empty_services):
    from hougang.controls.dataset_manager import DatasetManager

    small_limit = DatasetManager(empty_services["repository"], max_upload_mb=0)
    with pytest.raises(ValidationError, match="0 MB limit"):
        small_limit.import_file(file_upload(rows_to_csv(fixture_rows()[:5]), "resale.csv"))


def test_uc49_values_are_normalised(manager):
    row = {**fixture_rows()[0], "flat_type": "multi generation", "town": " bedok ", "floor_area_sqm": "44.00",
           "month": "2020-03-01"}
    [parsed] = manager.validate_file(file_upload(rows_to_csv([row]), "resale.csv"))
    assert parsed.flat_type == "MULTI-GENERATION"
    assert parsed.town == "BEDOK"
    assert parsed.floor_area_sqm == 44.0
    assert parsed.transaction_month == "2020-03"


@pytest.mark.parametrize(
    "field, value",
    [("month", "2016-12"), ("month", "2026-13"), ("flat_type", "6 ROOM"), ("storey_range", "10 TO 07"),
     ("floor_area_sqm", "5"), ("lease_commence_date", "2099"), ("resale_price", "0"), ("town", "")],
)
def test_uc49_row_rules(manager, field, value):
    row = {**fixture_rows()[0], field: value}
    with pytest.raises(ValidationError):
        manager.validate_file(file_upload(rows_to_csv([row]), "resale.csv"))


def test_uc49_check_file_validates_without_importing(manager, empty_services):
    raw = [{**r, "notes": "x"} for r in fixture_rows()[:25]]
    summary = manager.check_file(file_upload(rows_to_csv(raw), "resale.csv"))
    assert summary["status"] == "valid" and summary["rows_received"] == 25
    assert summary["ignored_columns"] == ["notes"]
    assert summary["first_month"] <= summary["latest_month"]
    assert empty_services["repository"].dataset_stats()["total_rows"] == 0
    assert empty_services["repository"].get_update_history(5) == []
