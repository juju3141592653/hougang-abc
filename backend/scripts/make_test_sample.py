"""Build tests/fixtures/sample_resale.csv: a reproducible sample of REAL rows from the data.gov.sg CSV.

Tests must not use invented transactions (CLAUDE.md), so the fixture is drawn from the downloaded
dataset with a fixed seed: 4,000 rows from the latest 24 months (enough to fit the model), every
MULTI-GENERATION sale in that window (flat type and flat model coincide, which the model's encoder
must handle), and 1,000 older rows (for history and period tests). Values are copied unchanged.

    python -m scripts.make_test_sample [--csv data/raw/resale_2017_onwards.csv]
"""

from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path

from hougang.config import BACKEND_DIR
from hougang.months import shift_month

SEED = 2006
RECENT_ROWS = 4000
OLDER_ROWS = 1000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=BACKEND_DIR / "data" / "raw" / "resale_2017_onwards.csv")
    args = parser.parse_args()

    with open(args.csv, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames
        rows = list(reader)
    latest = max(r["month"] for r in rows)
    cutoff = shift_month(latest, -23)
    recent = [r for r in rows if r["month"] >= cutoff]
    older = [r for r in rows if r["month"] < cutoff]
    rng = random.Random(SEED)
    sample = rng.sample(recent, RECENT_ROWS) + rng.sample(older, OLDER_ROWS)
    chosen = {id(r) for r in sample}
    sample += [r for r in recent if r["flat_type"] == "MULTI-GENERATION" and id(r) not in chosen]
    sample.sort(key=lambda r: r["month"])

    target = BACKEND_DIR / "tests" / "fixtures" / "sample_resale.csv"
    with open(target, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        writer.writerows(sample)
    print(f"Wrote {len(sample)} real rows ({cutoff} to {latest} recent) to {target}")


if __name__ == "__main__":
    main()
