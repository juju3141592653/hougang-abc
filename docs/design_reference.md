# Design reference (text transcription of `Lab3_Final_Three_Diagrams.pdf`)

Transcribed so code can be checked against exact names. The PDF wins if they differ.
Notation: `+` public, `-` private, `?` optional, `list[T]` / `dict[K, V]` collections.

## Page 1: Final design class diagram

Design baseline: UC-4.1 to UC-4.11.

### React boundaries
| Class | Attributes | Methods |
|---|---|---|
| `HomeSearchPageUI` | `- criteria: FilterCriteria` | `+ apply_filters(): void`, `+ load_options(): void` |
| `ResultsPageUI` | `- page: TransactionPage` | `+ show_latest(): void`, `+ select_record(id: int): void`, `+ show_town_map(): void` |
| `PropertyDetailsPageUI` | `- selected_record: Transaction`, `- criteria: FilterCriteria` | `+ load_record(id: int): void`, `+ open_history(): void`, `+ open_summary(): void`, `+ open_prediction(): void` |
| `HistoricalDataPageUI` | `- criteria: FilterCriteria`, `- page: TransactionPage` | `+ load_history(page: int): void`, `+ change_page(page: int): void`, `+ show_record_details(id: int): void` |
| `SummaryPageUI` | `- stats: SummaryStatistics` | `+ change_period(): void`, `+ render_chart(): void` |
| `PredictionPageUI` | `- inputs: PredictionInput`, `- result: Prediction?` | `+ submit_prediction(): void`, `+ show_price_and_breakdown(result: Prediction): void` |
| `AdminUI` | `- session_id: str?`, `- selected_file: File?` | `+ login(): void`, `+ upload_dataset(): void`, `+ show_diagnostics(): void` |

ResultsPageUI → PropertyDetailsPageUI: "opens selected record".

### Python controls
**`<<control>> SearchManager`**
- `- repository: TransactionRepository`
- `+ validate_filters(criteria: FilterCriteria): None`
- `+ get_details(id: int): Transaction`
- `+ get_filter_options(town: str): dict`
- `+ latest(criteria: FilterCriteria, page: int): TransactionPage`
- `+ history(criteria: FilterCriteria, page: int): TransactionPage`
- `+ summary(criteria: FilterCriteria, period: str?): SummaryStatistics`

**`<<control>> PredictionManager`**
- `- model: OLSRegressionModel`
- `- repository: TransactionRepository`
- `- min_samples: int`
- `+ validate_input(inputs: PredictionInput): None`
- `+ predict(inputs: PredictionInput): Prediction`
- `+ get_diagnostics(): ModelDiagnostics`

**`<<control>> AdminAuthService`**
- `- password_hash: str`
- `- sessions: dict[str, datetime]`
- `+ login(username: str, password: str): str`
- `+ require_admin(session_id: str): None`
- `+ logout(session_id: str): None`

**`<<control>> DatasetManager`**
- `- repository: TransactionRepository`
- `- client: DataGovClient`
- `+ validate_file(file: FileStorage): list[Transaction]`
- `+ parse_remaining_lease(value: str): float`
- `+ import_file(file: FileStorage): dict`
- `+ update_from_api(): dict`

### Adapters
**`<<repository / DAO>> TransactionRepository`**
- `- db_path: str`
- `+ query(criteria: FilterCriteria, page: int, recent: bool): TransactionPage`
- `+ all_matching(criteria: FilterCriteria): list[Transaction]`
- `+ find_by_id(id: int): Transaction?`
- `+ count_supporting(inputs: PredictionInput): int`
- `+ append_new(rows: list[Transaction]): int`
- `+ get_last_successful_update(): datetime?`
- `+ record_update_status(summary: dict): None`

**`<<model>> OLSRegressionModel`**
- `- artefact_path: str`
- `- coefficients: dict[str, float]`
- `- intercept: float`
- `+ load(): None`
- `+ fit(rows: list[Transaction]): None`
- `+ save(): None`
- `+ predict(inputs: PredictionInput): float`
- `+ explain(inputs: PredictionInput): list[PredictionBreakdown]`
- `+ is_represented(inputs: PredictionInput): bool`
- `+ diagnostics(): ModelDiagnostics`

**`<<external adapter>> DataGovClient`**
- `- dataset_id: str`
- `- timeout_seconds: int = 10`
- `+ fetch_records(): list[dict]`

**`<<startup>> AppBootstrap`** ("initialises and wires services")
- `- config: dict`
- `+ create_app(): Flask`
- `+ initialise_database(): None`
- `+ load_model(): None`
- `+ configure_daily_job(): None`

### Domain objects and collections
| Stereotype | Class | Fields (all public) |
|---|---|---|
| value object | `FilterCriteria` | `town: str`, `flat_type: str?`, `storey_range: str?`, `floor_area_sqm: float?`, `flat_model: str?` |
| container | `TransactionPage` | `records: list[Transaction]`, `page: int`, `page_size: int`, `total: int` |
| entity / persisted | `Transaction` | `id: int`, `transaction_month: str`, `town: str`, `flat_type: str`, `storey_range: str`, `flat_model: str`, `floor_area_sqm: float`, `lease_commence_date: int`, `remaining_lease_years: float`, `resale_price_sgd: float` |
| value object | `SummaryStatistics` | `count: int`, `mean_sgd: float`, `median_sgd: float`, `trend: dict[str, float]` |
| value object | `PredictionInput` | `town: str`, `flat_type: str`, `storey_range: str`, `flat_model: str`, `floor_area_sqm: float`, `lease_commence_date: int` |
| entity | `Prediction` | `estimated_price_sgd: float`, `base_price_sgd: float`, `reliability_warning: str?`, `breakdown_available: bool`, `breakdown: list[PredictionBreakdown]` |
| entity | `PredictionBreakdown` | `feature_name: str`, `input_value: str`, `contribution_sgd: float` |
| value object | `ModelDiagnostics` | `r_squared: float`, `adjusted_r_squared: float`, `rmse_sgd: float?`, `coefficients: dict[str, float]`, `p_values: dict[str, float]` |

Relationships: `TransactionPage` ◇ 1 → 0..* `Transaction` (aggregation); `Prediction` ◆ 1 → 0..*
`PredictionBreakdown` (composition). Labelled dependencies: AdminUI → AdminAuthService "login";
AdminUI → DatasetManager "dataset operations"; AdminUI → PredictionManager "admin diagnostics";
DatasetManager → TransactionRepository "append validated rows"; PredictionManager →
TransactionRepository "supporting data"; AppBootstrap "initialises and wires services".

### Notes on the diagram
- Dashed arrows: dependencies (uses / returns). Solid open arrows: navigable associations.
- React boundaries call Flask routes using JSON.
- Admin routes call `require_admin()` before dataset operations or model diagnostics.
- Repository persists rows and update metadata; the model artefact persists the fitted model,
  encoder and statistical diagnostics.
- Prediction = base price + contributions. No breakdown is allowed only on its error path.
- Model diagnostics are restricted to Admin.
- ADMIN ACCESS (UC-4.11): AdminUI handles the authorization screen. AdminAuthService verifies the
  admin session. UC-4.8 and UC-4.9 include the access check. React routing handles page navigation.

## Page 2: Final dialog map

### End-user pages
| State | Content |
|---|---|
| S1 Search Filter Page | Select town; dependent housing filters. Flat type; optional storey / area / model |
| E1 Filter errors | Field-specific message on S1. Retain inputs for correction |
| S2 Latest Results Page | Recent matching resale transactions. Select record; pagination. No recent records: suggest history |
| S2a Property Details Page | Selected HDB transaction details. View history / summary / prediction. Keep selected housing criteria |
| S3 Historical Data Page | All matching historical transactions. Paginated table / no-data message. Changing filters refreshes the table |
| S4 Summary Statistics Page | Mean, median and labelled price trend. Change period / filters to refresh. No-data message when needed |
| S5 Prediction Input Page | Pre-fill from selected property. Confirm all six property features. Submit a current fair-price estimate |
| E2 Prediction feedback | Missing / invalid input. Insufficient-data warning. Correct inputs or broaden criteria |
| S6 Price and Breakdown | Estimated resale price in SGD. Automatically show feature contributions. Show reliability warning when applicable. Breakdown failure: price + clear message |

Transitions: start → S1. S1 "Apply filters" → guard "Valid filters?": [invalid] → E1 ("Correct
filters" → S1); [valid] → S2. S2 "Change filters" → S1. S2 "Select record" → S2a. S2a "View
historical data" → S3; "View summary" → S4; "View prediction" → S5; "Back to results" → S2.
S3 "Back to results" → S2. S4 "Back to results" → S2. S5 "Predict" → guard "Valid inputs + enough
data?": [no] → E2 ("Correct inputs" → S5); [yes] → S6. S5 "Back to results" → S2. S6 "Change inputs
/ predict again" → S5; S6 "Back to results" → S2.

### Admin pages
| State | Content |
|---|---|
| S7 Admin Authorization (UC-4.11) | Enter credentials; create admin session |
| E3 Login failed | Stay on login page. Correct credentials |
| S8 Admin Dashboard | Dataset status and last successful update. Dataset management / model diagnostics / logout |
| S9 Dataset Management | Choose CSV / XLSX file. Upload for schema / value validation. Respect configured file-size limit |
| E4 Upload rejected | Wrong format / missing columns. Empty file / invalid values. Correct the file and retry |
| S9a Import Summary | Successful ingestion confirmation. Row count and accepted columns. Return to upload another file |
| S10 Model Diagnostics | R-squared / adjusted R-squared. Coefficients and significance. Unavailable model: message + retry |

Transitions: start → S7. S7 "Login" → guard "Authorised admin?": [denied] → E3 ("Retry" → S7);
[authorised] → S8. S8 "Manage dataset" → S9; "View diagnostics" → S10; "Logout to public search" →
S1. S9 "Upload" → guard "Valid dataset?": [rejected] → E4 ("Correct file / retry" → S9);
[accepted] → S9a ("Upload another file" → S9). S9 "Back to dashboard" → S8. S10 "Back to
dashboard" → S8.

### Notes on the dialog map
- Messages and page behaviour: errors and warnings appear on the current page. E1 and E2 implement
  UC-4.7 validation feedback. S2 / S3: no matching data is a page message. S4: changes to period or
  filters refresh analysis. S6: an unrepresented combination may still produce a price, with a
  reliability warning. Data / model unavailable: explain and allow retry. Historical-data
  sufficiency is configurable. The daily data update is a backend job, not a navigation state.
- Common navigation: New search from public pages → S1. Back to results preserves selected
  filters. Close browser (from any page) → End.
- Access control: S8–S10 require an authorised admin session; expired session → S7.
- Legend: rounded box = page / feedback state; dashed box = error / warning; diamond = guard; arrow
  label = action or guard outcome. Prediction breakdown is automatic, within S6 (UC-4.6).

## Page 3: Final system architecture

| Layer | Contents |
|---|---|
| Presentation (React web frontend) | HomeSearchPageUI (housing filters and search), ResultsPageUI (transaction cards and town map), PropertyDetailsPageUI (selected record and action buttons), HistoricalDataPageUI (price history and pagination), SummaryPageUI (mean, median and trend charts), PredictionPageUI (property inputs, price and breakdown), AdminUI (login, dataset upload and diagnostics). Admin access: UC-4.11 authorization, required for UC-4.8 / UC-4.9. React routing selects the page; shared filter state preserves the housing criteria. UI-to-manager dependencies cross the HTTP API; Python objects are not called directly from React. |
| ↕ | HTTP(S) requests / JSON responses |
| Application interface (Python Flask routes) | Public API: filter options / latest results / selected record details / history / summary / predict. Admin API and session checks: login / logout / upload / model diagnostics. |
| ↕ | Validate requests, invoke controls, serialize results |
| Application logic (Python control classes) | SearchManager: validate filters; retrieve details; latest / historical records; statistics. PredictionManager: validate inputs; check supporting data; coordinate OLS prediction and breakdown. DatasetManager: validate and import datasets; fetch daily updates; remove duplicates. AdminAuthService: verify credentials; manage sessions; authorize protected admin operations. |
| ↕ | SearchManager ↔ repository "query / details / statistics"; PredictionManager → repository "supporting records"; PredictionManager ↔ model "predict / explain / diagnostics"; DatasetManager → repository "validated imports and updates"; DatasetManager ↔ DataGovClient "fetch external records" |
| Data access and model | TransactionRepository: SQL reads and writes; transaction records and update metadata. OLSRegressionModel: encode inputs; estimate current fair price; feature contributions and model diagnostics. DataGovClient: retrieve official HDB resale records; timeout handling and source validation. |
| ↕ | SQL / load-save / HTTPS |
| Persistence (local to the Flask backend) | SQLite: transactions and ingestion metadata. Saved model artefacts: fitted OLS model, encoder and diagnostics. |
| External | data.gov.sg / HDB: external historical resale dataset, read-only data source. Daily scheduled job: invokes `DatasetManager.update_from_api()` ("scheduled trigger"). |
| Startup (AppBootstrap) | Creates Flask; initializes SQLite access; loads the model; wires managers and adapters; configures the daily job. |

Data exchanged as JSON: FilterCriteria / TransactionPage / Transaction / SummaryStatistics /
Prediction / ModelDiagnostics.
