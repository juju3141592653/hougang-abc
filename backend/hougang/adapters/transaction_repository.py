"""<<repository / DAO>> TransactionRepository: SQL reads and writes for transactions and update metadata.

Implements the persistence side of UC-4.1 to UC-4.5, UC-4.9 and UC-4.10. The `transactions` table
is append-only (SRS 4.10.3.2, NFR 5.4.3): there is no update or delete method, and SQLite triggers
reject UPDATE and DELETE.
"""

from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone

from hougang.domain import FilterCriteria, PredictionInput, Transaction, TransactionPage
from hougang.months import shift_month

# Executed by AppBootstrap.initialise_database().
SCHEMA_SQL = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS transactions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_month     TEXT    NOT NULL,
    town                  TEXT    NOT NULL,
    flat_type             TEXT    NOT NULL,
    block                 TEXT    NOT NULL,
    street_name           TEXT    NOT NULL,
    storey_range          TEXT    NOT NULL,
    flat_model            TEXT    NOT NULL,
    floor_area_sqm        REAL    NOT NULL,
    lease_commence_date   INTEGER NOT NULL,
    remaining_lease_years REAL    NOT NULL,
    resale_price_sgd      REAL    NOT NULL,
    fingerprint           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_town_type_month ON transactions (town, flat_type, transaction_month);
CREATE INDEX IF NOT EXISTS idx_tx_month ON transactions (transaction_month);
CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions (fingerprint);

CREATE TRIGGER IF NOT EXISTS transactions_no_update BEFORE UPDATE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS transactions_no_delete BEFORE DELETE ON transactions
BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END;

CREATE TABLE IF NOT EXISTS update_status (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at  TEXT NOT NULL,
    source       TEXT NOT NULL,
    status       TEXT NOT NULL,
    summary_json TEXT NOT NULL
);
"""

_COLUMNS = (
    "id, transaction_month, town, flat_type, storey_range, flat_model, floor_area_sqm, "
    "lease_commence_date, remaining_lease_years, resale_price_sgd, block, street_name"
)
_SQLITE_MAX_PARAMS = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _storey_sort_key(storey_range: str) -> int:
    try:
        return int(storey_range.split(" ")[0])
    except ValueError:
        return 999


class TransactionRepository:
    """<<repository / DAO>> Persists transaction rows and update metadata in SQLite.

    `db_path` is the diagram's private attribute. The other constructor arguments are configuration
    for paging, the "latest" window (decisions #17), the floor-area tolerance (#18) and the model's
    training window (#11, #14).
    """

    def __init__(
        self,
        db_path: str,
        page_size: int = 20,
        recent_months: int = 12,
        floor_area_tolerance_sqm: float = 5.0,
        training_window_months: int = 24,
    ):
        self._db_path = db_path
        self._page_size = page_size
        self._recent_months = recent_months
        self._floor_area_tolerance = floor_area_tolerance_sqm
        self._training_window_months = training_window_months
        self._distinct_cache: dict[tuple, dict] = {}

    # ------------------------------------------------------------------ reads (UC-4.1 to UC-4.5)

    def query(self, criteria: FilterCriteria, page: int, recent: bool) -> TransactionPage:
        """One page of matching transactions, newest first. `recent` limits to the latest months (UC-4.2)."""
        where, params = self._where(criteria)
        if recent:
            latest = self._latest_month()
            if latest is None:
                return TransactionPage(records=[], page=page, page_size=self._page_size, total=0)
            where.append("transaction_month >= ?")
            params.append(shift_month(latest, -(self._recent_months - 1)))
        clause = " AND ".join(where)
        offset = (page - 1) * self._page_size
        with closing(self._connect()) as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM transactions WHERE {clause}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM transactions WHERE {clause} "
                "ORDER BY transaction_month DESC, id DESC LIMIT ? OFFSET ?",
                [*params, self._page_size, offset],
            ).fetchall()
        return TransactionPage(
            records=[self._to_transaction(r) for r in rows], page=page, page_size=self._page_size, total=total
        )

    def all_matching(self, criteria: FilterCriteria) -> list[Transaction]:
        """Every transaction matching the criteria, oldest first (UC-4.4 statistics)."""
        where, params = self._where(criteria)
        with closing(self._connect()) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM transactions WHERE {' AND '.join(where)} ORDER BY transaction_month, id",
                params,
            ).fetchall()
        return [self._to_transaction(r) for r in rows]

    def find_by_id(self, id: int) -> Transaction | None:  # noqa: A002 - name from the class diagram
        """A single transaction, or None (UC-4.2 AC.1)."""
        with closing(self._connect()) as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM transactions WHERE id = ?", (id,)).fetchone()
        return self._to_transaction(row) if row else None

    def count_supporting(self, inputs: PredictionInput) -> int:
        """Supporting sales for a prediction (UC-4.7 EX.3, decisions #11).

        Returns the smallest number of sales in the training window that share any one of the four
        category values (town, flat type, flat model, storey range).
        """
        cutoff = self._training_cutoff()
        if cutoff is None:
            return 0
        counts = []
        with closing(self._connect()) as conn:
            for column, value in (
                ("town", inputs.town),
                ("flat_type", inputs.flat_type),
                ("flat_model", inputs.flat_model),
                ("storey_range", inputs.storey_range),
            ):
                counts.append(
                    conn.execute(
                        f"SELECT COUNT(*) FROM transactions WHERE {column} = ? AND transaction_month >= ?",
                        (value, cutoff),
                    ).fetchone()[0]
                )
        return min(counts)

    def training_rows(self, months: int) -> list[Transaction]:
        """Transactions in the most recent `months` months of data, for fitting the model (decisions #14)."""
        latest = self._latest_month()
        if latest is None:
            return []
        with closing(self._connect()) as conn:
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM transactions WHERE transaction_month >= ? ORDER BY transaction_month, id",
                (shift_month(latest, -(months - 1)),),
            ).fetchall()
        return [self._to_transaction(r) for r in rows]

    def distinct_values(self, town: str | None) -> dict:
        """Values available for each filter, overall or within one town (UC-4.1 step 3, decisions #24).

        Cached per town; the cache key includes the newest row id, so appends (from any process)
        invalidate it.
        """
        where, params = ("WHERE town = ?", [town]) if town else ("", [])
        with closing(self._connect()) as conn:
            newest_id = conn.execute("SELECT MAX(id) FROM transactions").fetchone()[0]
            key = (town or "", newest_id)
            if key in self._distinct_cache:
                return copy.deepcopy(self._distinct_cache[key])

            def distinct(column: str) -> list[str]:
                return [r[0] for r in conn.execute(f"SELECT DISTINCT {column} FROM transactions {where}", params)]

            towns = sorted(r[0] for r in conn.execute("SELECT DISTINCT town FROM transactions"))
            area = conn.execute(
                f"SELECT MIN(floor_area_sqm), MAX(floor_area_sqm) FROM transactions {where}", params
            ).fetchone()
            values = {
                "towns": towns,
                "flat_types": sorted(distinct("flat_type")),
                "storey_ranges": sorted(distinct("storey_range"), key=_storey_sort_key),
                "flat_models": sorted(distinct("flat_model")),
                "floor_area_min": area[0],
                "floor_area_max": area[1],
            }
        if len(self._distinct_cache) > 64:
            self._distinct_cache.clear()
        self._distinct_cache[key] = values
        return copy.deepcopy(values)

    def dataset_stats(self) -> dict:
        """Row count and month coverage of the stored dataset (S8, decisions #24)."""
        with closing(self._connect()) as conn:
            count, first, latest = conn.execute(
                "SELECT COUNT(*), MIN(transaction_month), MAX(transaction_month) FROM transactions"
            ).fetchone()
        return {"total_rows": count, "first_month": first, "latest_month": latest}

    # ------------------------------------------------------------------ writes (UC-4.9, UC-4.10)

    def append_new(self, rows: list[Transaction]) -> int:
        """Append rows not already stored; return how many were added.

        De-duplication compares fingerprint counts (a multiset), because the data has no stable
        transaction ID and two genuinely identical sales can exist: k copies in the input and j
        already stored means max(0, k - j) are inserted. Existing rows are never changed.
        """
        if not rows:
            return 0
        fingerprints = [self._fingerprint(r) for r in rows]
        wanted = Counter(fingerprints)
        with closing(self._connect()) as conn:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            try:
                stored: dict[str, int] = {}
                unique = list(wanted)
                for start in range(0, len(unique), _SQLITE_MAX_PARAMS):
                    chunk = unique[start : start + _SQLITE_MAX_PARAMS]
                    marks = ",".join("?" * len(chunk))
                    for fp, n in conn.execute(
                        f"SELECT fingerprint, COUNT(*) FROM transactions WHERE fingerprint IN ({marks}) "
                        "GROUP BY fingerprint",
                        chunk,
                    ):
                        stored[fp] = n
                remaining = {fp: max(0, k - stored.get(fp, 0)) for fp, k in wanted.items()}
                to_insert = []
                for row, fp in zip(rows, fingerprints):
                    if remaining[fp] > 0:
                        remaining[fp] -= 1
                        to_insert.append(
                            (
                                row.transaction_month, row.town, row.flat_type, row.block, row.street_name,
                                row.storey_range, row.flat_model, row.floor_area_sqm, row.lease_commence_date,
                                row.remaining_lease_years, row.resale_price_sgd, fp,
                            )
                        )
                conn.executemany(
                    "INSERT INTO transactions (transaction_month, town, flat_type, block, street_name, storey_range, "
                    "flat_model, floor_area_sqm, lease_commence_date, remaining_lease_years, resale_price_sgd, "
                    "fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    to_insert,
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return len(to_insert)

    def get_last_successful_update(self) -> datetime | None:
        """When the dataset was last updated successfully (UC-4.10 REQ-3, S8)."""
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT recorded_at FROM update_status WHERE status = 'success' ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return datetime.fromisoformat(row[0]) if row else None

    def record_update_status(self, summary: dict) -> None:
        """Store the outcome of an import or API update (UC-4.9, UC-4.10 REQ-3/4)."""
        recorded_at = summary.get("finished_at") or _now_iso()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO update_status (recorded_at, source, status, summary_json) VALUES (?, ?, ?, ?)",
                (recorded_at, summary.get("source", "unknown"), summary.get("status", "unknown"), json.dumps(summary)),
            )

    def get_update_history(self, limit: int) -> list[dict]:
        """The most recent update runs, newest first (S8 dataset status, decisions #15)."""
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT recorded_at, source, status, summary_json FROM update_status ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        history = []
        for recorded_at, source, status, summary_json in rows:
            entry = json.loads(summary_json)
            entry.update({"recorded_at": recorded_at, "source": source, "status": status})
            history.append(entry)
        return history

    # ------------------------------------------------------------------ private helpers

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _latest_month(self) -> str | None:
        with closing(self._connect()) as conn:
            return conn.execute("SELECT MAX(transaction_month) FROM transactions").fetchone()[0]

    def _training_cutoff(self) -> str | None:
        latest = self._latest_month()
        return shift_month(latest, -(self._training_window_months - 1)) if latest else None

    def _where(self, criteria: FilterCriteria) -> tuple[list[str], list]:
        where, params = ["town = ?"], [criteria.town]
        for column in ("flat_type", "storey_range", "flat_model"):
            value = getattr(criteria, column)
            if value:
                where.append(f"{column} = ?")
                params.append(value)
        if criteria.floor_area_sqm is not None:
            where.append("floor_area_sqm BETWEEN ? AND ?")
            params += [
                criteria.floor_area_sqm - self._floor_area_tolerance,
                criteria.floor_area_sqm + self._floor_area_tolerance,
            ]
        return where, params

    @staticmethod
    def _to_transaction(row: sqlite3.Row) -> Transaction:
        return Transaction(
            id=row["id"],
            transaction_month=row["transaction_month"],
            town=row["town"],
            flat_type=row["flat_type"],
            storey_range=row["storey_range"],
            flat_model=row["flat_model"],
            floor_area_sqm=row["floor_area_sqm"],
            lease_commence_date=row["lease_commence_date"],
            remaining_lease_years=row["remaining_lease_years"],
            resale_price_sgd=row["resale_price_sgd"],
            block=row["block"],
            street_name=row["street_name"],
        )

    @staticmethod
    def _fingerprint(row: Transaction) -> str:
        """Hash of every source field after normalisation, so "44.00" and "44" match."""
        key = "|".join(
            [
                row.transaction_month, row.town, row.flat_type, row.block, row.street_name, row.storey_range,
                row.flat_model, f"{row.floor_area_sqm:.2f}", str(row.lease_commence_date),
                f"{row.remaining_lease_years:.4f}", f"{row.resale_price_sgd:.2f}",
            ]
        )
        return hashlib.sha1(key.encode("utf-8")).hexdigest()
