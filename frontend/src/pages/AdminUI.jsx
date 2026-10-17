// <<boundary>> AdminUI: dialog map S7 Admin Authorization, E3 Login failed, S8 Admin Dashboard,
// S9 Dataset Management, E4 Upload rejected, S9a Import Summary, S10 Model Diagnostics.
// UC-4.11 Authorize Admin, UC-4.9 Manage Database, UC-4.8 View Model Diagnostics, UC-4.10 (manual
// check). Methods mirror the class diagram: login(), upload_dataset(), show_diagnostics().
// Attributes: session_id (str?), selected_file (File?).
// S8-S10 need a live admin session; a missing or expired session returns to S7 (and back after login).
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import Message, { FieldError } from "../components/Message.jsx";
import { formatDateTime, formatMonth, formatSGD } from "../components/format.js";

const SESSION_KEY = "hougang.admin.session";
const DEFAULT_UPLOAD_LIMIT_MB = 50; // replaced by the server's MAX_UPLOAD_MB once the status loads

function readSession() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(value) {
  try {
    if (value) window.sessionStorage.setItem(SESSION_KEY, value);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export default function AdminUI() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session_id, setSessionId] = useState(readSession);
  const [selected_file, setSelectedFile] = useState(null);

  // Session changes and the navigation they cause are applied in one transition, so the "no session
  // -> login" guard below never sees a half-updated state (it would override where we are going).
  const changeSession = useCallback(
    (value, to, options) => {
      writeSession(value);
      startTransition(() => {
        setSessionId(value);
        navigate(to, options);
      });
    },
    [navigate],
  );

  const endSession = useCallback(
    (message) => changeSession(null, "/admin/login", { replace: true, state: { from: location.pathname, message } }),
    [changeSession, location.pathname],
  );

  /** Call an admin endpoint; a 401 (no or expired session) sends the admin to S7. Returns null then. */
  const call = useCallback(
    async (request, ...args) => {
      try {
        return await request(session_id, ...args);
      } catch (error) {
        if (error.status === 401) {
          endSession(error.message);
          return null;
        }
        throw error;
      }
    },
    [session_id, endSession],
  );

  /** login(): verify credentials (UC-4.11). Success -> S8 (or the page that required login); failure -> E3. */
  async function login(username, password) {
    const { session_id: newSession } = await api.admin.login(username, password);
    const from = location.state?.from;
    changeSession(newSession, from && from !== "/admin/login" ? from : "/admin", { replace: true });
  }

  async function logout() {
    try {
      await api.admin.logout(session_id);
    } catch {
      /* the session is discarded either way */
    }
    changeSession(null, "/"); // "Logout to public search" (S1)
  }

  /** upload_dataset(): send the selected file for validation and import (UC-4.9). S9a or E4. */
  const upload_dataset = () => call(api.admin.uploadDataset, selected_file);

  /** show_diagnostics(): fetch the model diagnostics (UC-4.8). */
  const show_diagnostics = useCallback(() => call(api.admin.diagnostics), [call]);

  const protect = (element) =>
    session_id ? element : <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="page admin">
      <Routes>
        <Route
          path="login"
          element={
            session_id ? (
              <Navigate to="/admin" replace />
            ) : (
              <LoginView onLogin={login} notice={location.state?.message} />
            )
          }
        />
        <Route index element={protect(<DashboardView call={call} onLogout={logout} />)} />
        <Route
          path="dataset"
          element={protect(
            <DatasetView
              call={call}
              selectedFile={selected_file}
              onSelectFile={setSelectedFile}
              onUpload={upload_dataset}
            />,
          )}
        />
        <Route path="diagnostics" element={protect(<DiagnosticsView onLoad={show_diagnostics} />)} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  );
}

// ---------------------------------------------------------------- S7 Admin Authorization / E3

function LoginView({ onLogin, notice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err); // E3: stay on the login page
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel login-panel" aria-labelledby="login-heading">
      <h1 id="login-heading">Admin login</h1>
      <p className="muted">Dataset management and model diagnostics are for administrators only.</p>
      {notice && !error && <Message kind="info">{notice}</Message>}
      {error && (
        <Message kind="error" title={error.status === 401 ? "Login failed" : "Please check the form"}>
          {error.message}
        </Message>
      )}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="admin-username">Username</label>
          <input
            id="admin-username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={Boolean(error?.fields?.username)}
          />
          <FieldError message={error?.fields?.username} />
        </div>
        <div className="field">
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(error?.fields?.password)}
          />
          <FieldError message={error?.fields?.password} />
        </div>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- S8 Admin Dashboard

function DashboardView({ call, onLogout }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await call(api.admin.status);
      if (result) setStatus(result);
    } catch (err) {
      setError(err);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkNow() {
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await call(api.admin.updateFromApi);
      if (result) {
        setCheckResult(result);
        await load();
      }
    } catch (err) {
      setCheckResult({ status: "failed", message: err.message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Dashboard</h1>
        </div>
        <div className="page-header-actions">
          <button type="button" className="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      {error && <Message kind="error" title="Couldn't load the dataset status">{error.message}</Message>}

      {status && (
        <>
          <section className="panel" aria-labelledby="dataset-status">
            <h2 id="dataset-status">Dataset status</h2>
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">Transactions stored</span>
                <span className="stat-value">{(status.total_rows || 0).toLocaleString("en-SG")}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Coverage</span>
                <span className="stat-value stat-value-small">
                  {status.first_month ? `${formatMonth(status.first_month)} – ${formatMonth(status.latest_month)}` : "No data"}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Last successful update</span>
                <span className="stat-value stat-value-small">{formatDateTime(status.last_successful_update)}</span>
              </div>
            </div>
            {status.needs_attention?.length > 0 && (
              <Message kind="warning" title="Needs attention">
                <ul className="plain-list">
                  {status.needs_attention.map((run) => (
                    <li key={`${run.recorded_at}-${run.source}`}>
                      {formatDateTime(run.recorded_at)} · {run.source === "api" ? "data.gov.sg update" : "upload"}:{" "}
                      {run.status === "failed" ? run.message : `${run.rows_rejected} record(s) rejected`}
                      {run.rejected_reasons?.length > 0 && (
                        <ul>
                          {run.rejected_reasons.slice(0, 5).map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </Message>
            )}
          </section>

          <section className="panel">
            <h2>Actions</h2>
            <div className="action-grid">
              <Link className="button action button-primary" to="/admin/dataset">
                <strong>Manage dataset</strong>
                <span>Upload a .csv or .xlsx file</span>
              </Link>
              <Link className="button action" to="/admin/diagnostics">
                <strong>View diagnostics</strong>
                <span>R², coefficients and significance</span>
              </Link>
              <button type="button" className="button action" onClick={checkNow} disabled={checking}>
                <strong>{checking ? "Checking data.gov.sg…" : "Check data.gov.sg now"}</strong>
                <span>Runs the daily update immediately</span>
              </button>
            </div>
            {checkResult && (
              <Message kind={checkResult.status === "success" ? "success" : "error"} title="data.gov.sg check">
                {checkResult.status === "success"
                  ? `${checkResult.rows_received.toLocaleString("en-SG")} recent records checked, ${checkResult.rows_added} new added${
                      checkResult.rows_rejected ? `, ${checkResult.rows_rejected} rejected` : ""
                    }${checkResult.model_retrained ? "; model retrained" : ""}.`
                  : checkResult.message}
              </Message>
            )}
          </section>

          <section className="panel">
            <h2>Recent updates</h2>
            {status.recent_updates?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Source</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="number">
                        Rows added
                      </th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.recent_updates.map((run) => (
                      <tr key={`${run.recorded_at}-${run.source}-${run.status}`}>
                        <td>{formatDateTime(run.recorded_at)}</td>
                        <td>{run.source === "api" ? "data.gov.sg" : `Upload ${run.filename || ""}`}</td>
                        <td>
                          <span className={`pill pill-${run.status}`}>{run.status}</span>
                        </td>
                        <td className="number">{run.rows_added == null ? "–" : run.rows_added.toLocaleString("en-SG")}</td>
                        <td>{run.message || (run.rows_rejected ? `${run.rows_rejected} rejected` : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No updates recorded yet.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- S9 Dataset Management / E4 / S9a

function DatasetView({ call, selectedFile, onSelectFile, onUpload }) {
  const [limitMb, setLimitMb] = useState(DEFAULT_UPLOAD_LIMIT_MB);
  const [rejection, setRejection] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  // Also confirms the session is still valid as soon as the page opens (expired -> S7).
  useEffect(() => {
    call(api.admin.status)
      .then((status) => status?.max_upload_mb && setLimitMb(status.max_upload_mb))
      .catch(() => {});
  }, [call]);

  function choose(event) {
    const file = event.target.files?.[0] || null;
    onSelectFile(file);
    setRejection(null);
  }

  async function upload(event) {
    event.preventDefault();
    if (!selectedFile) {
      setRejection({ message: "Choose a .csv or .xlsx file to upload." });
      return;
    }
    const extension = selectedFile.name.toLowerCase().split(".").pop();
    if (!["csv", "xlsx"].includes(extension)) {
      setRejection({ message: "Wrong file format. Upload a .csv or .xlsx file." });
      return;
    }
    if (selectedFile.size > limitMb * 1024 * 1024) {
      setRejection({ message: `The file is larger than the ${limitMb} MB limit.` });
      return;
    }
    setBusy(true);
    setRejection(null);
    try {
      const result = await onUpload();
      if (result) setSummary(result);
    } catch (err) {
      setRejection({ message: err.message, details: err.details }); // E4
    } finally {
      setBusy(false);
    }
  }

  function uploadAnother() {
    setSummary(null);
    onSelectFile(null);
    setInputKey((key) => key + 1);
  }

  return (
    <>
      <Link className="back-link" to="/admin">
        ← Back to dashboard
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Dataset management</h1>
          <p className="muted">
            Upload HDB resale transactions in the official data.gov.sg format. New rows are appended; rows already
            stored are skipped; existing records are never changed.
          </p>
        </div>
      </header>

      {summary ? (
        <section className="panel" aria-live="polite">
          <Message kind="success" title="Import complete">
            {summary.filename} was validated and imported.
          </Message>
          <dl className="detail-list">
            <div>
              <dt>Rows in file</dt>
              <dd>{summary.rows_received.toLocaleString("en-SG")}</dd>
            </div>
            <div>
              <dt>New rows added</dt>
              <dd>{summary.rows_added.toLocaleString("en-SG")}</dd>
            </div>
            <div>
              <dt>Already stored (skipped)</dt>
              <dd>{summary.duplicates_skipped.toLocaleString("en-SG")}</dd>
            </div>
            <div>
              <dt>Months covered</dt>
              <dd>
                {formatMonth(summary.first_month)} – {formatMonth(summary.latest_month)}
              </dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{summary.model_retrained ? "Retrained on the updated data" : "Unchanged (no new rows)"}</dd>
            </div>
          </dl>
          <p>
            <strong>Accepted columns:</strong> {summary.accepted_columns.join(", ")}
          </p>
          {summary.ignored_columns?.length > 0 && (
            <Message kind="info" title="Extra columns ignored">
              {summary.ignored_columns.join(", ")}
            </Message>
          )}
          <div className="form-actions">
            <button type="button" className="button button-primary" onClick={uploadAnother}>
              Upload another file
            </button>
            <Link className="button" to="/admin">
              Back to dashboard
            </Link>
          </div>
        </section>
      ) : (
        <form className="panel" onSubmit={upload} noValidate>
          {rejection && (
            <Message kind="error" title="Upload rejected">
              <p>{rejection.message}</p>
              {rejection.details?.missing_columns && (
                <p>
                  Missing columns: <strong>{rejection.details.missing_columns.join(", ")}</strong>
                </p>
              )}
              {rejection.details?.row_errors?.length > 0 && (
                <ul className="plain-list">
                  {rejection.details.row_errors.map((rowError) => (
                    <li key={rowError}>{rowError}</li>
                  ))}
                </ul>
              )}
              <p>Correct the file and upload it again.</p>
            </Message>
          )}
          <div className="field">
            <label htmlFor="dataset-file">Dataset file (.csv or .xlsx, up to {limitMb} MB)</label>
            <input key={inputKey} id="dataset-file" type="file" accept=".csv,.xlsx" onChange={choose} />
            {selectedFile && (
              <p className="field-hint">
                {selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>
          <p className="field-hint">
            Required columns: month, town, flat_type, block, street_name, storey_range, floor_area_sqm, flat_model,
            lease_commence_date, remaining_lease, resale_price.
          </p>
          <div className="form-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Validating and importing…" : "Upload"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------- S10 Model Diagnostics

function DiagnosticsView({ onLoad }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onLoad();
      if (result) setDiagnostics(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [onLoad]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    if (!diagnostics) return [];
    const needle = filter.trim().toLowerCase();
    return Object.entries(diagnostics.coefficients)
      .filter(([name]) => !needle || name.toLowerCase().includes(needle))
      .map(([name, value]) => ({ name, value, p: diagnostics.p_values[name] }));
  }, [diagnostics, filter]);

  return (
    <>
      <Link className="back-link" to="/admin">
        ← Back to dashboard
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Model diagnostics</h1>
          <p className="muted">
            Ordinary least squares fit on the most recent 24 months of transactions (in-sample). Category coefficients
            are relative to the reference level shown in brackets.
          </p>
        </div>
      </header>

      {loading && !diagnostics && <p className="muted">Loading…</p>}
      {error && (
        <Message
          kind="error"
          title={error.status === 503 ? "Model unavailable" : "Couldn't load diagnostics"}
          action={
            <button type="button" className="button" onClick={load}>
              Retry
            </button>
          }
        >
          {error.message} {error.status === 503 && "Diagnostics will be available once a model has been trained."}
        </Message>
      )}

      {diagnostics && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">R²</span>
              <span className="stat-value">{diagnostics.r_squared.toFixed(4)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Adjusted R²</span>
              <span className="stat-value">{diagnostics.adjusted_r_squared.toFixed(4)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">RMSE</span>
              <span className="stat-value">{formatSGD(diagnostics.rmse_sgd)}</span>
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>Coefficients and significance</h2>
              <input
                type="search"
                aria-label="Filter coefficients"
                placeholder="Filter, e.g. Town"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col" className="number">
                      Coefficient (S$)
                    </th>
                    <th scope="col" className="number">
                      p-value
                    </th>
                    <th scope="col">Significant at 5%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="number">{formatSGD(row.value, { signed: row.name !== "Intercept" })}</td>
                      <td className="number">{row.p < 0.0001 ? "< 0.0001" : row.p.toFixed(4)}</td>
                      <td>{row.p < 0.05 ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
