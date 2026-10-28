"""Record real API responses as JSON fixtures for the React tests.

The frontend tests mock HTTP calls; to avoid inventing data, the mocked responses are recorded
from this backend running on tests/fixtures/sample_resale.csv (real data.gov.sg rows).

    python -m scripts.make_frontend_fixtures
"""

from __future__ import annotations

import io
import json
import tempfile
from collections import Counter
from pathlib import Path

from werkzeug.datastructures import FileStorage

from hougang.bootstrap import AppBootstrap
from hougang.config import BACKEND_DIR, REPO_DIR, load_config

SAMPLE = BACKEND_DIR / "tests" / "fixtures" / "sample_resale.csv"
TARGET = REPO_DIR / "frontend" / "src" / "__tests__" / "fixtures" / "api.json"
PASSWORD = "fixture-password"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        config = load_config(
            {
                "DB_PATH": f"{tmp}/db.sqlite",
                "MODEL_ARTEFACT_PATH": f"{tmp}/model.json",
                "SCHEDULER_ENABLED": False,
                "ADMIN_USERNAME": "admin",
                "ADMIN_PASSWORD": PASSWORD,
                "ADMIN_PASSWORD_HASH": None,
                "FRONTEND_DIST": f"{tmp}/none",
            }
        )
        app = AppBootstrap(config).create_app()
        services = app.extensions["hougang"]
        with open(SAMPLE, "rb") as fh:
            services["dataset_manager"].import_file(FileStorage(stream=fh, filename="sample_resale.csv"))
        services["prediction_manager"].retrain()
        client = app.test_client()

        window = services["repository"].training_rows(24)
        town = Counter(r.town for r in window).most_common(1)[0][0]
        record = next(r for r in window if r.town == town and r.flat_type == "4 ROOM")
        criteria = {"town": town, "flat_type": "4 ROOM"}

        def get(url, **query):
            return client.get(url, query_string=query).get_json()

        latest = get("/api/transactions/latest", **criteria)
        detail_id = latest["records"][0]["id"]
        prediction_body = {
            "town": record.town, "flat_type": record.flat_type, "storey_range": record.storey_range,
            "flat_model": record.flat_model, "floor_area_sqm": record.floor_area_sqm,
            "lease_commence_date": record.lease_commence_date,
        }
        rare_storey = next(v for v, n in Counter(r.storey_range for r in window).items() if n < 30)
        seen = {(r.town, r.flat_type, r.flat_model, r.storey_range) for r in window}
        common_storeys = [v for v, n in Counter(r.storey_range for r in window).most_common() if n >= 30]
        unseen_storey = next(s for s in common_storeys if (town, "4 ROOM", record.flat_model, s) not in seen)

        login = client.post("/api/admin/login", json={"username": "admin", "password": PASSWORD}).get_json()
        headers = {"Authorization": f"Bearer {login['session_id']}"}
        header_line = SAMPLE.read_text(encoding="utf-8").splitlines()[0]
        bad_csv = header_line.replace(",resale_price", "") + "\n"

        fixtures = {
            "_source": "Recorded by backend/scripts/make_frontend_fixtures.py from real data.gov.sg rows.",
            "criteria": criteria,
            "filterOptionsAll": get("/api/filter-options"),
            "filterOptionsTown": get("/api/filter-options", town=town),
            "filterOptionsTownType": get("/api/filter-options", town=town, flat_type="4 ROOM"),
            "latest": latest,
            "latestPage2": get("/api/transactions/latest", page=2, **criteria),
            "latestEmpty": get("/api/transactions/latest", town=town, floor_area_sqm=399),
            "filterValidationError": client.get(
                "/api/transactions/latest", query_string={"town": town, "floor_area_sqm": "huge"}
            ).get_json(),
            "transaction": get(f"/api/transactions/{detail_id}"),
            "history": get("/api/transactions/history", **criteria),
            "summaryAll": get("/api/summary", period="all", **criteria),
            "summary1y": get("/api/summary", period="1y", **criteria),
            "summaryEmpty": get("/api/summary", town=town, floor_area_sqm=399),
            "lastUpdated": get("/api/last-updated"),
            "predictionInput": prediction_body,
            "prediction": client.post("/api/predict", json=prediction_body).get_json(),
            "predictionUnseen": client.post(
                "/api/predict", json={**prediction_body, "storey_range": unseen_storey}
            ).get_json(),
            "predictionInsufficient": client.post(
                "/api/predict", json={**prediction_body, "storey_range": rare_storey}
            ).get_json(),
            "predictionValidationError": client.post("/api/predict", json={"town": town}).get_json(),
            "loginFailed": client.post("/api/admin/login", json={"username": "admin", "password": "wrong"}).get_json(),
            "adminStatus": client.get("/api/admin/status", headers=headers).get_json(),
            "diagnostics": client.get("/api/admin/diagnostics", headers=headers).get_json(),
            "datasetCheck": client.post(
                "/api/admin/dataset/check", headers=headers, content_type="multipart/form-data",
                data={"file": (io.BytesIO(SAMPLE.read_bytes()), "sample_resale.csv")},
            ).get_json(),
            "uploadRejected": client.post(
                "/api/admin/dataset", headers=headers, content_type="multipart/form-data",
                data={"file": (io.BytesIO(bad_csv.encode()), "missing-price.csv")},
            ).get_json(),
            "uploadSummary": client.post(
                "/api/admin/dataset", headers=headers, content_type="multipart/form-data",
                data={"file": (io.BytesIO(SAMPLE.read_bytes()), "sample_resale.csv")},
            ).get_json(),
        }
        assert fixtures["predictionUnseen"].get("reliability_warning"), "expected an unseen-combination warning"
        assert fixtures["predictionInsufficient"]["error"]["code"] == "insufficient_data"

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(fixtures, indent=1), encoding="utf-8")
    print(f"Wrote {TARGET} ({TARGET.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
