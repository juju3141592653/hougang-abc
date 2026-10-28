# Traceability: use cases → classes → Flask routes → React pages → tests

Class and method names are exactly those of the design class diagram (`Lab3_Final_Three_Diagrams.pdf`,
p.1; transcribed in `design_reference.md`). Pages carry the dialog-map state ids (p.2). Approved
additions to the diagram are marked † and explained in `decisions.md`.

Backend tests are named after the use case they verify, so `pytest -k uc45` runs every test for
UC-4.5 (run from `backend/`). Frontend tests are grouped by dialog-map state in
`frontend/src/__tests__/publicFlows.test.jsx` and `adminFlows.test.jsx`.

## Use cases

| Use case | Control / adapter classes and methods | Domain objects | Flask routes | React page (dialog map) | Tests |
|---|---|---|---|---|---|
| **UC-4.1** Select Housing Filters | `SearchManager.validate_filters`, `SearchManager.get_filter_options(town, flat_type†)`; `TransactionRepository.distinct_values(town, flat_type†)`†, `TransactionRepository.query` | `FilterCriteria` | `GET /api/filter-options?town=&flat_type=`, `GET /api/transactions/latest` (validates the filters for S1) | `HomeSearchPageUI` (S1, E1): `load_options()`, `apply_filters()` | `pytest -k uc41` (search manager, routes, repository; options narrow by town and flat type: `test_uc41_options_narrow_by_town_and_flat_type`); frontend "S1 Search Filter Page" (4 tests) |
| **UC-4.2** View Latest Price | `SearchManager.latest`, `SearchManager.get_details`; `TransactionRepository.query(recent=True)`, `TransactionRepository.find_by_id` | `TransactionPage`, `Transaction` (+`block`, `street_name`†) | `GET /api/transactions/latest`, `GET /api/transactions/<id>` | `ResultsPageUI` (S2): `show_latest()`, `select_record(id)`, `show_town_map()`, plus S2 → S3/S4/S5 for the whole search (#28); `PropertyDetailsPageUI` (S2a): `load_record(id)`, `open_history()`, `open_summary()`, `open_prediction()` | `pytest -k uc42`; frontend "S2 Latest Results Page" (6 tests), "Back from S3 / S4 / S5 returns to the property (S2a)" (3 tests) |
| **UC-4.3** View Historical Data | `SearchManager.history`; `TransactionRepository.query(recent=False)` | `TransactionPage` | `GET /api/transactions/history`, `GET /api/transactions/<id>` | `HistoricalDataPageUI` (S3): `load_history(page)`, `change_page(page)`, `show_record_details(id)` | `pytest -k uc43`; frontend "S3 Historical Data Page" (2 tests) |
| **UC-4.4** View Summary Statistics | `SearchManager.summary`; `TransactionRepository.all_matching`, `TransactionRepository.dataset_stats`† | `SummaryStatistics` (+`volume`, `median_psm_sgd`†) | `GET /api/summary` (also feeds the 12-month figures on S2) | `SummaryPageUI` (S4): `change_period()`, `render_chart()` | `pytest -k uc44`; frontend "S4 Summary Statistics Page" (3 tests) |
| **UC-4.5** View Fair Price Prediction | `PredictionManager.validate_input`, `PredictionManager.predict`; `OLSRegressionModel.predict`, `OLSRegressionModel.is_represented`, `OLSRegressionModel.typical_error`†; `TransactionRepository.count_supporting` | `PredictionInput`, `Prediction` (+`typical_error_sgd`†) | `POST /api/predict` | `PredictionPageUI` (S5, S6): `submit_prediction()`, `show_price_and_breakdown(result)`; likely range on S6 | `pytest -k uc45` (incl. `test_uc45_typical_error_grows_with_price_level`); frontend "S5 / S6 prediction" (7 tests) |
| **UC-4.6** View Prediction Breakdown (included by 4.5) | `OLSRegressionModel.explain` (called by `PredictionManager.predict`) | `PredictionBreakdown` | `POST /api/predict` (breakdown in the same response) | `PredictionPageUI` (S6, automatic) | `pytest -k uc46`; frontend "pre-fills S5 … breakdown automatically", "breakdown fails (UC-4.6 EX.1)" |
| **UC-4.7** Validate and Handle Error | `SearchManager.validate_filters`, `PredictionManager.validate_input`, `PredictionManager.min_samples` with `TransactionRepository.count_supporting`; exceptions in `errors.py`†; JSON error handlers in `routes/serializers.py` | – | every public route: 400 (E1/E2 field errors), 422 (insufficient data), 503 (dataset unavailable) | E1 on `HomeSearchPageUI`; E2 on `PredictionPageUI`; no-data messages on S2, S3, S4 | `pytest -k uc47`; frontend "E1 …", "E2 …", "no recent records", "no-data message" |
| **UC-4.8** View Model Diagnostics (admin) | `PredictionManager.get_diagnostics`; `OLSRegressionModel.diagnostics`, `OLSRegressionModel.load` | `ModelDiagnostics` (+`n_observations`, `training_from`, `training_to`, `fitted_at`†) | `GET /api/admin/diagnostics` (requires session) | `AdminUI` (S10): `show_diagnostics()` | `pytest -k uc48`; frontend "S10 Model Diagnostics" (2 tests) |
| **UC-4.9** Manage Database (admin) | `DatasetManager.validate_file`, `DatasetManager.check_file`†, `DatasetManager.parse_remaining_lease`, `DatasetManager.import_file`; `TransactionRepository.append_new`, `TransactionRepository.record_update_status`; `PredictionManager.retrain`† after new rows | `Transaction` | `POST /api/admin/dataset/check`† (validate only), `POST /api/admin/dataset` (both require a session) | `AdminUI` (S9, E4, S9a): `upload_dataset()`, `check_dataset()` | `pytest -k uc49` (incl. `test_uc49_check_file_validates_without_importing`, `test_uc49_check_route_validates_only`); frontend "S9 Dataset Management" (4 tests) |
| **UC-4.10** Update Price Database (scheduler) | `AppBootstrap.configure_daily_job`; `DatasetManager.update_from_api`, `DatasetManager.get_status`†; `DataGovClient.fetch_records`; `TransactionRepository.append_new`, `record_update_status`, `get_last_successful_update`, `get_update_history`†; `PredictionManager.retrain`† | `Transaction` | daily job (03:00 SGT); `POST /api/admin/update-from-api`† (manual run); `GET /api/admin/status`† (S8); `GET /api/last-updated`† (public) | `AdminUI` (S8 dashboard, "Check data.gov.sg now"); footer "Last updated" on every page | `pytest -k uc410`; frontend "runs the data.gov.sg check from the dashboard" |
| **UC-4.11** Authorize Admin (included by 4.8, 4.9) | `AdminAuthService.login` (locks after 5 failures for 5 minutes†), `AdminAuthService.require_admin`, `AdminAuthService.logout`; `admin_required` decorator on every protected admin route | – | `POST /api/admin/login`, `POST /api/admin/logout`; 401 from every protected route | `AdminUI` (S7, E3): `login()`; expired session → S7 | `pytest -k uc411` (incl. `test_uc411_account_locks_after_repeated_failures`); frontend "S7 Admin Authorization" (6 tests) |

Startup (all use cases): `AppBootstrap.create_app`, `initialise_database`, `load_model`,
`configure_daily_job` — `backend/tests/test_bootstrap.py`, `test_prediction_api.py::test_startup_*`.

## Dialog-map navigation

| Arrow | Implementation | Tests |
|---|---|---|
| S1 → S2 [valid filters] / E1 | `apply_filters()` calls the latest-results endpoint; 400 stays on S1 | frontend "valid filters lead to S2", "E1: …" |
| S2 → S2a; S2a → "Back to results" → S2 (filters kept) | `ListingCard` link; shared `FilterContext` | frontend "selecting a record opens S2a …" |
| S2a → S3 / S4 / S5; each "Back to property details" → the same S2a | origin passed in router state (`components/navigation.js`, #28) | frontend "Back from S3 / S4 / S5 returns to the property (S2a)" (3 tests) |
| S2 → S3 / S4 / S5 (#28); each "Back to results" → S2 | buttons "Price history", "Market summary", "Estimate a price" | frontend "opens S3, S4 and S5 for the whole search, each coming 'Back to results'" |
| S5 → S6 / E2; S6 "Change inputs / predict again" → S5 | `PredictionPageUI` | frontend "S5 / S6 prediction" |
| Header "Price estimate" → S5; unknown URL → not-found page | `Layout`, `App` | frontend "Navigation" |
| S7 → S8 [authorised] / E3; S8 ↔ S9 ↔ S10; logout → S1; expired session → S7 → back to the page requested | `AdminUI` | frontend "S7 Admin Authorization" |
| S9 → S9a / E4; S9a "Upload another file" → S9 | `AdminUI` | frontend "S9 Dataset Management" |

## Non-functional requirements and business rules

| Requirement | How it is met | Evidence |
|---|---|---|
| NFR 5.1.1 response times (3 s data, 5 s forecast, 2 s UI) | Indexed SQLite queries; cached filter values; OLS inference is a dot product | Measured on the full 242,955-row dataset: latest results 2–5 ms, history 18 ms, summary ≤ 173 ms, predict ≈ 80 ms, login < 0.2 s |
| NFR 5.1.2 external API timeout 10 s | `DataGovClient(timeout_seconds=10)`; 429 retried with back-off | `test_nfr512_requests_use_a_10_second_timeout`, `test_uc410_ex1_*` |
| NFR 5.2.1 estimate transparency | S6 shows "Estimated current fair price" and a disclaimer (not an official valuation or financial advice); S4 labels figures as actual transactions | frontend "pre-fills S5 …" asserts the disclaimer |
| NFR 5.3.1 passwords not stored in plaintext; only admins modify the dataset | `ADMIN_PASSWORD` hashed at startup (Werkzeug scrypt) and dropped; every admin route calls `require_admin()`; login locks after 5 failures (#32); security headers and a Content-Security-Policy on every response (#34) | `test_nfr531_*`, `test_plaintext_admin_password_is_dropped_from_config`, `test_uc411_admin_routes_refuse_requests_without_a_session`, `test_uc411_account_locks_after_repeated_failures`, `test_security_headers_are_set` |
| NFR 5.4.3 historical values never modified | Append-only repository; SQLite triggers reject UPDATE and DELETE | `test_nfr543_transactions_are_append_only` |
| NFR 5.4.4 separate components | React boundaries / Flask routes / control classes / adapters, as in the architecture diagram | folder structure |
| NFR 5.4.5 testability | Every functional requirement has named tests (above) | 177 backend + 39 frontend tests; a headless-Chrome walk-through of every dialog-map state (47 checks, desktop / 1024 px / phone) |
| BR 5.5.1 estimates always labelled | S6 heading and disclaimer; history and summary pages say "actual" sales | as above |
| BR 5.5.2 no estimate on insufficient data; only valid records used | `min_samples` check → E2; invalid rows rejected on upload and flagged on API update | `test_uc47_ex3_*`, `test_uc49_invalid_values_*`, `test_uc410_ex2_*` |
| SRS 2.5 linear model only; collinearity handled | statsmodels OLS; `remaining_lease` excluded (collinear with lease year); identical dummy columns dropped | `test_uc45_predictions_match_an_independent_least_squares_fit`, `test_identical_dummy_columns_are_dropped` |
