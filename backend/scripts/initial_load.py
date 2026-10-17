"""Initial data load: download the HDB resale dataset from data.gov.sg and import it.

The rows go through DatasetManager.import_file(), the same path as an admin upload (UC-4.9), so
they get identical validation and de-duplication. Re-running adds 0 rows.

    python -m scripts.initial_load                 # download from data.gov.sg, import, train
    python -m scripts.initial_load --csv FILE.csv  # import a CSV you downloaded yourself
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from werkzeug.datastructures import FileStorage

from hougang.config import REPO_DIR, load_config

DOWNLOAD_API = "https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/{action}"
RATE_LIMIT_WAIT_SECONDS = 11
POLL_ATTEMPTS = 20


def _call_download_api(action: str, dataset_id: str, headers: dict, timeout: int) -> dict:
    url = DOWNLOAD_API.format(dataset_id=dataset_id, action=action)
    for _ in range(6):
        response = requests.get(url, headers=headers, timeout=timeout)
        body = response.json() if response.content else {}
        if response.status_code == 429 or body.get("code") == 24:
            print(f"  data.gov.sg rate limit reached, waiting {RATE_LIMIT_WAIT_SECONDS}s ...")
            time.sleep(RATE_LIMIT_WAIT_SECONDS)
            continue
        response.raise_for_status()
        return body
    raise RuntimeError("data.gov.sg kept rate-limiting the request; try again later or set DATA_GOV_SG_API_KEY")


def download_dataset(config: dict) -> Path:
    """Download the full CSV via data.gov.sg's initiate-download / poll-download API."""
    headers = {"x-api-key": config["DATA_GOV_SG_API_KEY"]} if config["DATA_GOV_SG_API_KEY"] else {}
    timeout = config["API_TIMEOUT_SECONDS"]
    dataset_id = config["DATASET_ID"]
    print(f"Requesting download of data.gov.sg dataset {dataset_id} ...")
    body = _call_download_api("initiate-download", dataset_id, headers, timeout)
    url = (body.get("data") or {}).get("url")
    attempts = 0
    while not url and attempts < POLL_ATTEMPTS:
        time.sleep(3)
        attempts += 1
        body = _call_download_api("poll-download", dataset_id, headers, timeout)
        url = (body.get("data") or {}).get("url")
    if not url:
        raise RuntimeError(f"data.gov.sg did not return a download link: {body}")

    target = Path(config["RAW_DATA_DIR"]) / "resale_2017_onwards.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading CSV ...")
    with requests.get(url, stream=True, timeout=60) as response:
        response.raise_for_status()
        with open(target, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    print(f"Saved {target} ({target.stat().st_size / 1e6:.1f} MB)")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, help="import this CSV instead of downloading")
    parser.add_argument("--no-train", action="store_true", help="skip fitting the regression model")
    args = parser.parse_args(argv)

    load_dotenv(REPO_DIR / ".env")
    # The full dataset is bigger than a typical admin upload, so lift the size limit for this script.
    config = load_config({"SCHEDULER_ENABLED": False, "MAX_UPLOAD_MB": 1024})

    from hougang.bootstrap import AppBootstrap

    services = AppBootstrap(config).create_app().extensions["hougang"]
    csv_path = args.csv or download_dataset(config)

    print(f"Importing {csv_path} through DatasetManager.import_file() ...")
    started = time.time()
    with open(csv_path, "rb") as fh:
        summary = services["dataset_manager"].import_file(FileStorage(stream=fh, filename=csv_path.name))
    print(
        f"  {summary['rows_received']:,} rows read, {summary['rows_added']:,} added, "
        f"{summary['duplicates_skipped']:,} already present ({time.time() - started:.1f}s). "
        f"Months {summary['first_month']} to {summary['latest_month']}."
    )

    if not args.no_train and "prediction_manager" in services:
        print("Fitting the OLS model ...")
        started = time.time()
        diagnostics = services["prediction_manager"].retrain()
        print(
            f"  R² {diagnostics.r_squared:.3f}, adjusted R² {diagnostics.adjusted_r_squared:.3f}, "
            f"RMSE S${diagnostics.rmse_sgd:,.0f} ({time.time() - started:.1f}s)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
