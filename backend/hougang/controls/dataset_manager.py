"""<<control>> DatasetManager: validate and import datasets, fetch daily updates, remove duplicates.

Implements UC-4.9 Manage Database (admin upload of .csv / .xlsx) and UC-4.10 Update Price Database
(daily data.gov.sg job). Both paths share one set of row rules, so a row means the same thing
whichever way it arrives. Rows are only ever appended (SRS 4.10.3.2).
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from pathlib import PurePath

import pandas as pd

from hougang.adapters.transaction_repository import TransactionRepository
from hougang.domain import Transaction
from hougang.errors import DataSourceError, ValidationError
from hougang.months import current_month

# The official HDB resale schema (docs/decisions.md #6).
REQUIRED_COLUMNS = (
    "month",
    "town",
    "flat_type",
    "block",
    "street_name",
    "storey_range",
    "floor_area_sqm",
    "flat_model",
    "lease_commence_date",
    "remaining_lease",
    "resale_price",
)
FLAT_TYPES = ("1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "MULTI-GENERATION")
ACCEPTED_EXTENSIONS = (".csv", ".xlsx")
MAX_ROW_ERRORS_REPORTED = 20
MAX_REJECTED_ROWS_RECORDED = 50
FLOOR_AREA_RANGE = (20.0, 400.0)
EARLIEST_LEASE_YEAR = 1960

_LEASE_TEXT = re.compile(r"^(\d{1,2})\s*years?(?:\s+(\d{1,2})\s*months?)?$", re.IGNORECASE)
_MONTH_TEXT = re.compile(r"^(\d{4})-(\d{2})(?:-\d{2}(?:[ T].*)?)?$")
_STOREY_TEXT = re.compile(r"^(\d{2}) TO (\d{2})$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DatasetManager:
    """<<control>> Validates and imports datasets (UC-4.9) and runs the daily update (UC-4.10)."""

    def __init__(self, repository: TransactionRepository, client=None, max_upload_mb: int = 50):
        self._repository = repository
        self._client = client
        self._max_upload_bytes = max_upload_mb * 1024 * 1024

    # ------------------------------------------------------------------ UC-4.9 Manage Database

    def validate_file(self, file) -> list[Transaction]:
        """Check format, size, columns and every row; return the rows as Transactions (UC-4.9 steps 5-6).

        Raises ValidationError listing the problem (E4): wrong format, too large, missing columns,
        no data rows, or invalid values (first 20 row errors).
        """
        rows, _accepted, _ignored = self._read_and_validate(file)
        return rows

    def parse_remaining_lease(self, value: str) -> float:
        """Convert remaining lease text to years, e.g. "61 years 04 months" -> 61.3333 (SRS 4.9.3.2).

        Also accepts "61 years" and a bare number. Raises ValueError for anything else.
        """
        text = str(value).strip()
        match = _LEASE_TEXT.match(text)
        if match:
            years, months = int(match.group(1)), int(match.group(2) or 0)
            if months > 11:
                raise ValueError(f"remaining_lease {value!r} has more than 11 months")
            return round(years + months / 12, 4)
        try:
            years = float(text)
        except ValueError:
            raise ValueError(f"remaining_lease {value!r} is not in the form '61 years 04 months'") from None
        if not 0 < years <= 99:
            raise ValueError(f"remaining_lease {value!r} is outside 0-99 years")
        return round(years, 4)

    def check_file(self, file) -> dict:
        """Validate a file without importing it (UC-4.9 "check", decisions #33).

        Returns what an import would read: row count, months covered, accepted and ignored columns.
        Raises ValidationError (E4) exactly as an import would. Nothing is stored or recorded.
        """
        filename = PurePath(getattr(file, "filename", "") or "").name
        rows, accepted, ignored = self._read_and_validate(file)
        months = sorted({r.transaction_month for r in rows})
        return {
            "status": "valid",
            "filename": filename,
            "rows_received": len(rows),
            "accepted_columns": accepted,
            "ignored_columns": ignored,
            "first_month": months[0],
            "latest_month": months[-1],
        }

    def import_file(self, file) -> dict:
        """Validate a file and append its new rows (UC-4.9). Returns the import summary shown on S9a."""
        filename = PurePath(getattr(file, "filename", "") or "").name
        try:
            rows, accepted, ignored = self._read_and_validate(file)
        except ValidationError as exc:
            self._repository.record_update_status(
                {"source": "upload", "status": "rejected", "filename": filename, "message": exc.message,
                 "finished_at": _now_iso()}
            )
            raise
        added = self._repository.append_new(rows)
        months = sorted({r.transaction_month for r in rows})
        summary = {
            "source": "upload",
            "status": "success",
            "filename": filename,
            "rows_received": len(rows),
            "rows_added": added,
            "duplicates_skipped": len(rows) - added,
            "accepted_columns": accepted,
            "ignored_columns": ignored,
            "first_month": months[0],
            "latest_month": months[-1],
            "finished_at": _now_iso(),
        }
        self._repository.record_update_status(summary)
        return summary

    # ------------------------------------------------------------------ UC-4.10 Update Price Database

    def update_from_api(self) -> dict:
        """Fetch recent records from data.gov.sg and append the new valid ones (UC-4.10).

        Invalid records are flagged in the run summary, not inserted (EX.2). If the API fails, the
        failure is recorded for the admin and the database is left unchanged (EX.1). Never raises
        for those cases, so the scheduled job keeps running.
        """
        if self._client is None:
            raise RuntimeError("DatasetManager has no DataGovClient")
        try:
            records = self._client.fetch_records()
        except DataSourceError as exc:
            summary = {"source": "api", "status": "failed", "message": exc.message, "rows_added": 0,
                       "finished_at": _now_iso()}
            self._repository.record_update_status(summary)
            return summary

        valid: list[Transaction] = []
        rejected: list[str] = []
        for index, record in enumerate(records, start=1):
            normalised = {str(k).strip().lower(): v for k, v in record.items()}
            missing = [c for c in REQUIRED_COLUMNS if c not in normalised]
            try:
                if missing:
                    raise ValueError(f"missing fields {', '.join(missing)}")
                valid.append(self._to_transaction({c: normalised[c] for c in REQUIRED_COLUMNS}))
            except ValueError as exc:
                rejected.append(f"Record {record.get('_id', index)}: {exc}")
        added = self._repository.append_new(valid)
        summary = {
            "source": "api",
            "status": "success",
            "rows_received": len(records),
            "rows_added": added,
            "duplicates_skipped": len(valid) - added,
            "rows_rejected": len(rejected),
            "rejected_reasons": rejected[:MAX_REJECTED_ROWS_RECORDED],
            "finished_at": _now_iso(),
        }
        self._repository.record_update_status(summary)
        return summary

    def get_status(self) -> dict:
        """Dataset status for the admin dashboard S8 and the public "data as of" line (decisions #15)."""
        last = self._repository.get_last_successful_update()
        history = self._repository.get_update_history(10)
        return {
            **self._repository.dataset_stats(),
            "last_successful_update": last.isoformat() if last else None,
            "recent_updates": history,
            "needs_attention": [
                h for h in history
                if h["status"] == "failed" or (h["status"] == "success" and h.get("rows_rejected"))
            ],
        }

    # ------------------------------------------------------------------ private helpers

    def _read_and_validate(self, file) -> tuple[list[Transaction], list[str], list[str]]:
        filename = PurePath(getattr(file, "filename", "") or "").name
        extension = PurePath(filename.lower()).suffix
        if extension not in ACCEPTED_EXTENSIONS:
            raise ValidationError(
                "Wrong file format. Upload a .csv or .xlsx file.", fields={"file": "Accepted formats: .csv, .xlsx"}
            )
        data = file.read()
        if len(data) > self._max_upload_bytes:
            limit_mb = self._max_upload_bytes // (1024 * 1024)
            raise ValidationError(
                f"The file is larger than the {limit_mb} MB limit.", fields={"file": f"Maximum size is {limit_mb} MB"}
            )
        table = self._read_table(data, extension)
        table.columns = [str(c).strip().lower() for c in table.columns]
        missing = [c for c in REQUIRED_COLUMNS if c not in table.columns]
        if missing:
            raise ValidationError(
                f"The file is missing required columns: {', '.join(missing)}.",
                fields={"file": "Missing columns"},
                details={"missing_columns": missing, "required_columns": list(REQUIRED_COLUMNS)},
            )
        ignored = [c for c in table.columns if c not in REQUIRED_COLUMNS]
        table = table[list(REQUIRED_COLUMNS)]
        if table.empty:
            raise ValidationError("The file contains no data rows.", fields={"file": "No data rows"})

        rows: list[Transaction] = []
        errors: list[str] = []
        error_count = 0
        for line, values in enumerate(table.itertuples(index=False, name=None), start=2):
            try:
                rows.append(self._to_transaction(dict(zip(REQUIRED_COLUMNS, values))))
            except ValueError as exc:
                error_count += 1
                if len(errors) < MAX_ROW_ERRORS_REPORTED:
                    errors.append(f"Row {line}: {exc}")
        if error_count:
            raise ValidationError(
                f"{error_count} row(s) have invalid values. Correct the file and upload it again.",
                fields={"file": "Invalid values"},
                details={"row_errors": errors, "invalid_row_count": error_count},
            )
        return rows, list(REQUIRED_COLUMNS), ignored

    @staticmethod
    def _read_table(data: bytes, extension: str) -> pd.DataFrame:
        try:
            if extension == ".csv":
                return pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False, encoding="utf-8-sig")
            return pd.read_excel(io.BytesIO(data), dtype=str, engine="openpyxl").fillna("")
        except pd.errors.EmptyDataError:
            raise ValidationError("The file is empty.", fields={"file": "No data rows"}) from None
        except Exception as exc:  # malformed CSV / not really an Excel file
            raise ValidationError(
                f"The file could not be read as {extension}: {exc}", fields={"file": "Unreadable file"}
            ) from None

    def _to_transaction(self, raw: dict) -> Transaction:
        """Validate and normalise one source row. Raises ValueError naming the bad field."""
        value = {k: ("" if v is None else str(v).strip()) for k, v in raw.items()}
        for column in REQUIRED_COLUMNS:
            if value[column] == "":
                raise ValueError(f"{column} is empty")

        month_match = _MONTH_TEXT.match(value["month"])
        if not month_match or not 1 <= int(month_match.group(2)) <= 12:
            raise ValueError(f"month {value['month']!r} is not YYYY-MM")
        month = f"{month_match.group(1)}-{month_match.group(2)}"
        if month < "2017-01" or month > current_month():
            raise ValueError(f"month {month} is outside Jan 2017 to the current month")

        flat_type = re.sub(r"\s+", " ", value["flat_type"].upper()).replace("MULTI GENERATION", "MULTI-GENERATION")
        if flat_type not in FLAT_TYPES:
            raise ValueError(f"flat_type {value['flat_type']!r} is not an HDB flat type")

        storey = re.sub(r"\s+", " ", value["storey_range"].upper())
        storey_match = _STOREY_TEXT.match(storey)
        if not storey_match or int(storey_match.group(1)) > int(storey_match.group(2)):
            raise ValueError(f"storey_range {value['storey_range']!r} is not in the form '07 TO 09'")

        area = self._number(value["floor_area_sqm"], "floor_area_sqm")
        if not FLOOR_AREA_RANGE[0] <= area <= FLOOR_AREA_RANGE[1]:
            raise ValueError(f"floor_area_sqm {area:g} is outside {FLOOR_AREA_RANGE[0]:g}-{FLOOR_AREA_RANGE[1]:g}")

        lease_year = self._number(value["lease_commence_date"], "lease_commence_date")
        if lease_year != int(lease_year) or not EARLIEST_LEASE_YEAR <= lease_year <= int(month[:4]):
            raise ValueError(
                f"lease_commence_date {value['lease_commence_date']!r} must be a year between "
                f"{EARLIEST_LEASE_YEAR} and the sale year"
            )

        price = self._number(value["resale_price"], "resale_price")
        if price <= 0:
            raise ValueError(f"resale_price {value['resale_price']!r} must be positive")

        return Transaction(
            id=None,
            transaction_month=month,
            town=re.sub(r"\s+", " ", value["town"].upper()),
            flat_type=flat_type,
            storey_range=storey,
            flat_model=re.sub(r"\s+", " ", value["flat_model"]),
            floor_area_sqm=area,
            lease_commence_date=int(lease_year),
            remaining_lease_years=self.parse_remaining_lease(value["remaining_lease"]),
            resale_price_sgd=price,
            block=value["block"].upper(),
            street_name=re.sub(r"\s+", " ", value["street_name"].upper()),
        )

    @staticmethod
    def _number(text: str, column: str) -> float:
        try:
            number = float(text.replace(",", ""))
        except ValueError:
            raise ValueError(f"{column} {text!r} is not a number") from None
        if number != number:  # NaN
            raise ValueError(f"{column} is not a number")
        return number
