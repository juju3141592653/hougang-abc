"""Helpers for YYYY-MM month strings (the dataset's `month` column)."""

from __future__ import annotations

import re
from datetime import date

MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")


def shift_month(month: str, delta: int) -> str:
    """Return `month` moved by `delta` months, e.g. shift_month("2026-01", -1) == "2025-12"."""
    match = MONTH_PATTERN.match(month)
    if not match:
        raise ValueError(f"Not a YYYY-MM month: {month!r}")
    index = int(match.group(1)) * 12 + int(match.group(2)) - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def current_month(today: date | None = None) -> str:
    today = today or date.today()
    return f"{today.year:04d}-{today.month:02d}"


def month_label(month: str) -> str:
    """'2026-10' -> 'Oct 2026' (for messages)."""
    year, mon = month.split("-")
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{names[int(mon) - 1]} {year}"
