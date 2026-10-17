# Hougang ABC: HDB resale price web app (SC2006 Group 2)

Public users look up Singapore HDB resale flat prices: search with filters, browse latest and
historical transactions, view summary statistics, and get a fair-price estimate from an OLS linear
regression with a breakdown of each feature's contribution. An admin logs in, uploads datasets and
views model diagnostics. A daily job pulls new transactions from data.gov.sg.

This is a software engineering module project: optimise for faithful implementation of the team's
design, traceability to the use cases, and tests, not model accuracy.

## Sources, in priority order

1. `docs/Lab3_Final_Three_Diagrams.pdf`: **main reference.** p1 design class diagram, p2 dialog
   map, p3 system architecture. Defines classes, attributes, method signatures, layers, pages and
   navigation. Text transcription: `docs/design_reference.md` (check it against the PDF if in doubt).
2. `docs/SC2006_Hougang_ABC_SRS_v8.pdf`: SRS (pp. 1–31) and use case descriptions UC-4.1 to UC-4.11
   (pp. 32–48). Use it for behaviour the diagrams don't spell out: flows, validation rules, error
   and warning messages, non-functional requirements.
3. `docs/decisions.md`: the user's rulings on conflicts and gaps between 1 and 2. Where it records a
   decision, that decision wins.

If the diagrams and the SRS disagree, or something is ambiguous and `docs/decisions.md` does not
settle it: **ask the user. Don't guess.**

`~/Documents/GitHub/sc2006-hougang-backend` is an older FastAPI prototype built from SRS v7 and an
older class diagram. It is not a source of truth for this repo. Do not copy its structure or names.

## Stack

- Backend: Python 3.11, Flask, SQLite, pandas, numpy, statsmodels (OLS), APScheduler, pytest.
- Frontend: React (Vite), React Router; tests with Vitest and React Testing Library.
- Data: Singapore HDB resale transactions from data.gov.sg only.

## Rules

### Structure
- Use the class diagram names exactly: classes, attributes, methods, parameters and return types.
  Private helper functions (leading underscore) are fine. **New classes or new public methods need
  the user's OK** (record approvals in `docs/decisions.md`).
- Keep the layers from the architecture diagram:
  React boundaries → Flask routes → control classes → repository / model / adapter →
  SQLite, saved model artefact, data.gov.sg. No layer skipping (e.g. routes never touch SQLite).
- React talks to Flask only over HTTP/JSON. Flask routes validate requests, call the control
  classes and serialise results.
- `AppBootstrap` creates the Flask app, initialises SQLite, loads the model, wires the managers and
  adapters, and configures the daily job, which calls `DatasetManager.update_from_api()`.

### Frontend
- One React page component per boundary class, with the same name: `HomeSearchPageUI`,
  `ResultsPageUI`, `PropertyDetailsPageUI`, `HistoricalDataPageUI`, `SummaryPageUI`,
  `PredictionPageUI`, `AdminUI`.
- Routes and navigation follow the dialog map. Errors and warnings (E1–E4) appear on the current
  page. Shared filter state means "Back to results" keeps the selected filters.
- The price breakdown appears automatically with the estimate (S6). If the breakdown fails, show
  the price with a clear message.

### Behaviour
- Prediction = base price + feature contributions.
- Not enough supporting data (`PredictionManager.min_samples`) goes to E2. A combination the model
  hasn't seen still gets a price, with a reliability warning.
- Every admin route calls `AdminAuthService.require_admin()` first. Model diagnostics are
  admin-only. An expired session returns the admin to the login page (S7).
- Data: Singapore HDB resale transactions only, from data.gov.sg. Model: OLS linear regression only.
- Never hard-code the admin password. Load it from an environment variable and store only a hash.
- **Never invent transaction data.** If data.gov.sg can't be reached, tell the user (they will
  download the CSV). Tests use real rows sampled from the data.gov.sg dataset; hand-written rows
  only for deliberately invalid inputs.

### Quality
- Each class, route and page gets a short docstring or comment naming the use case it implements
  (e.g. `UC-4.5`).
- pytest tests for every control class, the repository and the model, written alongside the code;
  plus tests for the key frontend flows. Name tests after the use case (`test_uc45_...`).
- README: how to install, run, test and log in as admin.
- Traceability table in `docs/traceability.md`: use case → classes → Flask routes → React pages →
  tests.

## Working style

- Work in milestones (plan in `docs/decisions.md` §E). After each milestone: run all tests and
  summarise what was built. On 2026-10-17 the user said to proceed on judgement ("the ultimate goal
  is to build a good application as this is a graded assignment"), so open questions get a
  reasoned ruling recorded in `docs/decisions.md` rather than a stop.
- Before saying anything is done, run the tests and report real results, failures included.

## Commands

- Backend setup: `cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`
- Load data (downloads from data.gov.sg, imports via DatasetManager, trains): `.venv/bin/python -m scripts.initial_load`
- Run API (+ built frontend if `frontend/dist` exists): `.venv/bin/python run.py` → http://127.0.0.1:5001
- Backend tests: `.venv/bin/python -m pytest` (`-k uc45` for one use case)
- Frontend: `cd frontend && npm install`, `npm run dev` (proxies /api to 5001), `npm test`, `npm run build`
- Regenerate test data from real rows: `python -m scripts.make_test_sample`, then `python -m scripts.make_frontend_fixtures`

## Conventions

- Diagram private attributes (`-name`) are Python `_name`; public methods keep the diagram's snake_case
  names. React pages keep the diagram's method names (`apply_filters`, `show_latest`, …) as inner functions.
- Errors are raised as `hougang.errors` exceptions and serialised as `{"error": {code, message, fields, details}}`.

## Status

- All milestones M1–M7 are done (`docs/decisions.md` §E). All conflicts and gaps are DECIDED (§A–§C).
