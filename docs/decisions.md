# Decisions log

Rulings on conflicts and gaps between the diagrams (`Lab3_Final_Three_Diagrams.pdf`, main
reference) and the SRS (`SC2006_Hougang_ABC_SRS_v8.pdf`), plus approved additions to the class
diagram. Raised 2026-10-17. On 2026-10-17 the user delegated these decisions ("do whatever you
deem is right … the ultimate goal is to build a good application"), so every item below is
**DECIDED** unless marked otherwise. New items need the same care: record them here.

## A. Conflicts between the diagrams and the SRS

| # | Issue | Ruling |
|---|---|---|
| 1 | **Forecast vs current price.** SRS 3.1, 5.5.1, 6.2 and the p.13 mockup describe a 1–10 year forecast (compound growth, not OLS). Dialog map S5: "current fair-price estimate"; `PredictionInput` has no horizon; no use case covers forecasting. | Current fair price only. Forecasting is out of scope. The SRS 5.2 / 5.5.1 labelling rules still apply: the estimate is always labelled as an estimate. |
| 2 | **Area comparison** (SRS 3.1, TOC 4.5): no use case, page or class. | Out of scope. |
| 3 | **±RMSE next to the estimate** (SRS 3.1). `Prediction` has no RMSE; `rmse_sgd` is in admin-only `ModelDiagnostics`. | Not shown on S6. RMSE is shown on S10. |
| 4 | **Per-prediction breakdown in diagnostics** (SRS 4.8.3.2, UC-4.8 AC.1). Predictions are not stored; `ModelDiagnostics` has no breakdown. | S10 shows R², adjusted R², RMSE, coefficients and p-values. The per-prediction breakdown is S6 (UC-4.6) for everyone. UC-4.8 AC.1 dropped. |
| 5 | **Upload: append vs replace/modify.** SRS 2.3, 5.3.1, UC-4.9 vs SRS 4.10.3.2, 5.4.3 and the diagram (`append_new` only). | Append-only with duplicate removal. SQLite triggers block UPDATE/DELETE on `transactions`. |
| 6 | **Mandatory upload columns.** SRS 2.7 lists 7; UC-4.9 lists another set; `Transaction` needs month and flat model. | Required: `month, town, flat_type, block, street_name, storey_range, floor_area_sqm, flat_model, lease_commence_date, remaining_lease, resale_price` (the official schema). Extra columns ignored and reported (UC-4.9 AC.1). |
| 7 | **Is flat type required on S1?** | Only town is required (`FilterCriteria.flat_type: str?`, UC-4.2/4.3 preconditions). |
| 8 | **Entry to S3/S4/S5.** Dialog map: only via S2a. UC flows/mockups: from the results page. S2 "suggest history" has no arrow. | Follow the dialog map (via S2a), plus a "View historical data" link in S2's empty-results message. |
| 9 | **`HistoricalDataPageUI.show_record_details(id)`** but no S3 → S2a arrow. | Expands the row in place on S3 (fetches the record by id). |
| 10 | **After login.** UC-4.11 step 8 vs dialog map [authorised] → S8. | Go to S8; if S7 was reached by redirect from another admin page (deep link or expired session), return there. |

## B. Gaps neither document settles

| # | Issue | Ruling |
|---|---|---|
| 11 | **Insufficient data vs unseen combination** (UC-4.7 EX.3 vs UC-4.5 AC.2, TBD-07). | `count_supporting(inputs)` = the smallest number of sales in the training window that share any one of the four category values (town, flat type, flat model, storey range). Below `min_samples` (default 30, env `MIN_SAMPLES`) → E2, no price. `is_represented(inputs)` = false if no training sale has the same town + flat type + flat model + storey range, or floor area / lease year falls outside the range seen for that flat type → price plus reliability warning. |
| 12 | **Model features and time.** | Features = the six `PredictionInput` fields (town, flat type, flat model, storey range one-hot with the most frequent level as reference; floor area and lease commencement year numeric). `remaining_lease` is excluded from the model: it is almost perfectly collinear with lease year within a short window (SRS 2.5, feature selection). No time variable; trained on the most recent 24 months of data (env `TRAINING_WINDOW_MONTHS`). Fitted with statsmodels OLS. |
| 13 | **Meaning of base price.** | `base_price_sgd` = average resale price in the training window. Contribution of each input = `Σ β·(x − training mean)` over that input's columns. Base + contributions = estimate exactly ("compared with an average recently sold flat"). |
| 14 | **Who trains the model.** | Added `PredictionManager.retrain(): ModelDiagnostics` and `TransactionRepository.training_rows(months: int): list[Transaction]`. Retrain runs at startup when no artefact exists, after an upload that added rows, and after a daily update that added rows. |
| 15 | **Dataset status and "flag the admin"** (S8; UC-4.10 step 5, REQ-3/4, EX.1/2). | Added `DatasetManager.get_status(): dict` and `TransactionRepository.get_update_history(limit: int): list[dict]`. Routes `GET /api/admin/status` (S8: data coverage, last successful update, recent runs with failures and rejected rows flagged) and `GET /api/last-updated` (public "data as of"). Rejected API rows are kept in the run summary (count + first 50 reasons). |
| 16 | **`Transaction` has no `block` / `street_name`.** | Added `block: str` and `street_name: str` to `Transaction` (needed to de-duplicate without merging genuine identical sales, and to show the address). The map is town-level: an embedded OpenStreetMap view centred on the town (approximate town-centre coordinates in the frontend). |
| 17 | **What "latest" means.** | The 12 most recent months of data (relative to the newest month in the DB). Page size 20 (env `PAGE_SIZE`). |
| 18 | **Floor-area filter.** | Matches flats within ±5 sqm (env `FLOOR_AREA_TOLERANCE_SQM`). |
| 19 | **`summary(criteria, period)`.** | `period` ∈ {`1y`, `3y`, `5y`, `all`} (default `all`), relative to the newest month in the DB. count / mean / median over that period; `trend` = median price per month keyed `YYYY-MM`. |
| 20 | **Invalid rows.** | Upload: reject the whole file and list the first 20 row errors (E4). Daily API update: insert valid rows, flag invalid ones in the run summary. |
| 21 | **Which data.gov.sg dataset** (TBD-01). | Only `d_8b84c4ee58e3cfc0ece0d773c8ca6abc` (HDB resale, Jan 2017 onwards; the only one with `remaining_lease`). The daily job fetches the last 3 months by month filter and de-duplicates. Initial load downloads the full CSV. |
| 22 | **Admin accounts.** | One admin: `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD` (or a pre-hashed `ADMIN_PASSWORD_HASH`) env vars, hashed at startup with Werkzeug; plaintext not kept. No roles or locking. In-memory sessions (lost on restart), 30-minute idle expiry (env `SESSION_IDLE_MINUTES`). Generic "Invalid username or password" on failure (SRS 4.11.3.3). |
| 23 | **Exception classes.** | `hougang/errors.py`: `HougangError` (base), `ValidationError` (field → message), `InsufficientDataError`, `NotFoundError`, `AuthError`, `ModelUnavailableError`, `DataSourceError`. |
| 24 | **Filter options need distinct values,** but no repository method returns them. | Added `TransactionRepository.distinct_values(town: str?): dict` and `TransactionRepository.dataset_stats(): dict` (row count, first and latest month). |
| 25 | **Manual update** (UC-4.10 notes: "consider whether Admin should also be able to manually trigger"). | S8 has a "Check data.gov.sg now" button → `POST /api/admin/update-from-api` → the same `DatasetManager.update_from_api()` as the daily job. Useful for the demo. |
| 26 | **Where validation runs.** | Controls validate their own inputs (`latest`/`history`/`summary` call `validate_filters`; `predict` calls `validate_input`), so they are safe whatever calls them. Routes check types (numbers, page) and serialise. S1 "Apply filters" calls the latest-results endpoint; a 400 shows E1 on S1, success moves to S2. |

## C. Defaults

- OLS via statsmodels; model artefact stored as JSON (no pickle) at `backend/data/model_artefact.json`.
- Mockup elements not in HDB data (photos, bathrooms, rent, sqft, private property) are not shown. Flat type instead of bedrooms; areas in sqm, prices in SGD.
- S6 always shows the SRS 5.2 disclaimer (statistical estimate, not a valuation or financial advice).
- Local development over HTTP. Flask on port 5001 (macOS uses 5000 for AirPlay); Vite dev server proxies `/api`. After `npm run build`, Flask also serves the built frontend, so one process runs the whole app. TLS 1.3 (SRS 3.4) is a deployment concern.
- Frontend in JavaScript (JSX), Vite, React Router, Recharts for the S4 chart. Shared filter state in a React context, persisted to `sessionStorage` so a refresh keeps it.
- Validation: town / flat type / storey range / flat model must be values present in the data; floor area 20–400 sqm; lease commencement year 1960 to the current year.
- Admin session id kept in `sessionStorage` (closing the browser ends it), sent as `Authorization: Bearer <id>`.
- Daily job: APScheduler inside the Flask process at 03:00 Asia/Singapore (env `DAILY_JOB_HOUR`); optional `DATA_GOV_SG_API_KEY`. External calls time out after 10 s; HTTP 429 is retried with back-off.
- Upload size limit 50 MB (env `MAX_UPLOAD_MB`).
- Errors are JSON: `{"error": {"code", "message", "fields"}}`. HTTP 400 validation, 401 auth, 404 not found, 422 insufficient data, 503 model or data source unavailable.
- Tests use real rows sampled from the data.gov.sg dataset (`backend/tests/fixtures/sample_resale.csv`); hand-written rows only for deliberately invalid inputs.

## D. Folder structure

```
hougang-abc/
├── CLAUDE.md, README.md, .env.example, .gitignore
├── docs/          design PDFs, design_reference.md, decisions.md, traceability.md
├── backend/
│   ├── run.py                      # AppBootstrap(config).create_app()
│   ├── requirements.txt, requirements-dev.txt, pytest.ini
│   ├── hougang/
│   │   ├── config.py               # env → config dict
│   │   ├── bootstrap.py            # AppBootstrap
│   │   ├── domain.py               # the 8 domain dataclasses
│   │   ├── errors.py               # exception classes (#23)
│   │   ├── controls/               # search_manager, prediction_manager, admin_auth_service, dataset_manager
│   │   ├── adapters/               # transaction_repository, ols_regression_model, data_gov_client
│   │   └── routes/                 # public_api.py (/api), admin_api.py (/api/admin), serializers.py
│   ├── scripts/initial_load.py     # download data.gov.sg CSV → DatasetManager import path → train
│   ├── data/                       # gitignored: hougang.db, model artefact, raw CSV
│   └── tests/                      # pytest
└── frontend/
    ├── package.json, vite.config.js
    └── src/
        ├── App.jsx                 # routes per dialog map
        ├── api/client.js           # JSON-over-HTTP calls only
        ├── state/FilterContext.jsx # shared filter state
        ├── pages/                  # the 7 boundary classes, one component each
        ├── components/             # presentational helpers
        └── __tests__/              # Vitest + React Testing Library
```

Frontend routes: `/` S1 (E1) · `/results` S2 · `/results/:id` S2a · `/history` S3 · `/summary` S4 ·
`/predict` S5, S6 (E2) · `/admin/login` S7 (E3) · `/admin` S8 · `/admin/dataset` S9, S9a (E4) ·
`/admin/diagnostics` S10. `AdminUI` renders all admin views.

## E. Milestone plan

| # | Scope | Status |
|---|---|---|
| M1 | Scaffold, config, `AppBootstrap` (`create_app`, `initialise_database`), SQLite schema, domain classes, `TransactionRepository`, `DatasetManager.validate_file` / `parse_remaining_lease` / `import_file`; `scripts/initial_load.py` | done |
| M2 | `SearchManager` + public routes (filter options, latest, details, history, summary) | done |
| M3 | `OLSRegressionModel` + `PredictionManager` + predict route; `AppBootstrap.load_model` | done |
| M4 | `AdminAuthService`, `DataGovClient`, `DatasetManager.update_from_api`, admin routes, daily job | done |
| M5 | React public pages (S1–S6, S2a, E1, E2) | done |
| M6 | React admin pages (S7–S10, S9a, E3, E4) | done |
| M7 | End-to-end check of every use case, README, `docs/traceability.md` | done |

The user asked (2026-10-17) to proceed on judgement, so milestones ran back to back; each ended with
the full test suite passing. M7's end-to-end check drove every dialog-map state in headless Chrome
against the real app on the full dataset (screenshots in `docs/screenshots/`); it found and fixed a
logout/expired-session navigation race in AdminUI and a phone-width overflow of the breakdown table.
An independent code review then found, and regression tests now cover: stale responses overwriting newer
ones on S2/S3/S4; concurrent retrains sharing one temp file (now unique, and retraining is serialised
with predictions so a request never mixes two models); non-finite numbers and out-of-range page / id
values returning 500 instead of field errors; the static route revealing whether files outside
`frontend/dist` exist; a filter error banner that never cleared; and the upload limit / floor-area
tolerance being hard-coded in the frontend (both now come from the server's configuration).
