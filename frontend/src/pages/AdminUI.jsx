// <<boundary>> AdminUI: dialog map S7 Admin Authorization, E3 Login failed, S8 Admin Dashboard,
// S9 Dataset Management, E4 Upload rejected, S9a Import Summary, S10 Model Diagnostics.
// UC-4.11 Authorize Admin, UC-4.9 Manage Database, UC-4.8 View Model Diagnostics, UC-4.10 (manual
// check). Methods mirror the class diagram: login(), upload_dataset(), show_diagnostics().
// Attributes: session_id (str?), selected_file (File?).
// S8-S10 need a live admin session; a missing or expired session returns to S7 (and back after login).
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Gauge,
  LayoutDashboard,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Sigma,
  UploadCloud,
  X,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import {
  flatTypeLabel,
  formatCount,
  formatDate,
  formatDateTime,
  formatMonth,
  formatSGD,
  formatTime,
  titleCase,
} from "../components/format.js";
import { Alert, Badge, Card, FieldError, PageHeader, Skeleton, Spinner, StatTile } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";

const SESSION_KEY = "hougang.admin.session";
const DEFAULT_UPLOAD_LIMIT_MB = 50; // replaced by the server's MAX_UPLOAD_MB once the status loads
const REQUIRED_COLUMNS = [
  "month",
  "town",
  "flat_type",
  "block",
  "street_name",
  "storey_range",
  "floor_area_sqm",
  "flat_model",
  "lease_commence_date",
  "remaining_lease",
  "resale_price",
];

function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-SG")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

  /** Validate the selected file without importing it (UC-4.9 "check", decisions #33). */
  const check_dataset = () => call(api.admin.checkDataset, selected_file);

  /** show_diagnostics(): fetch the model diagnostics (UC-4.8). */
  const show_diagnostics = useCallback(() => call(api.admin.diagnostics), [call]);

  const protect = (element) =>
    session_id ? (
      <AdminShell onLogout={logout}>{element}</AdminShell>
    ) : (
      <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
    );

  return (
    <Routes>
      <Route
        path="login"
        element={
          session_id ? <Navigate to="/admin" replace /> : <LoginView onLogin={login} notice={location.state?.message} />
        }
      />
      <Route index element={protect(<DashboardView call={call} />)} />
      <Route
        path="dataset"
        element={protect(
          <DatasetView
            call={call}
            selectedFile={selected_file}
            onSelectFile={setSelectedFile}
            onUpload={upload_dataset}
            onCheck={check_dataset}
          />,
        )}
      />
      <Route path="diagnostics" element={protect(<DiagnosticsView onLoad={show_diagnostics} />)} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

// ---------------------------------------------------------------- shell

function AdminShell({ onLogout, children }) {
  return (
    <div className="container admin-shell">
      <nav className="card admin-nav" aria-label="Administration">
        <span className="admin-nav-title">Administration</span>
        <NavLink to="/admin" end>
          <LayoutDashboard size={17} aria-hidden="true" />
          Dashboard
        </NavLink>
        <NavLink to="/admin/dataset">
          <Database size={17} aria-hidden="true" />
          Dataset
        </NavLink>
        <NavLink to="/admin/diagnostics">
          <Gauge size={17} aria-hidden="true" />
          Model diagnostics
        </NavLink>
        <hr />
        <button type="button" onClick={onLogout}>
          <LogOut size={17} aria-hidden="true" />
          Log out
        </button>
      </nav>
      <div className="admin-main">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- S7 Admin Authorization / E3

function LoginView({ onLogin, notice }) {
  useDocumentTitle("Administrator sign in");
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

  const locked = error?.details?.reason === "locked";
  return (
    <div className="auth-page">
      <section className="card auth-card" aria-labelledby="login-heading">
        <span className="auth-icon" aria-hidden="true">
          <Lock size={22} />
        </span>
        <div>
          <h1 id="login-heading" style={{ fontSize: "1.5rem" }}>
            Admin login
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Dataset management and model diagnostics are for administrators only.
          </p>
        </div>
        {notice && !error && <Alert kind="info">{notice}</Alert>}
        {error && (
          <Alert
            kind={locked ? "warning" : "error"}
            title={locked ? "Login temporarily locked" : error.status === 401 ? "Login failed" : "Please check the form"}
          >
            {error.message}
          </Alert>
        )}
        <form onSubmit={submit} noValidate style={{ display: "grid", gap: 16 }}>
          <div className="field">
            <label htmlFor="admin-username">Username</label>
            <input
              id="admin-username"
              className="control"
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
              className="control"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(error?.fields?.password)}
            />
            <FieldError message={error?.fields?.password} />
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <Spinner />}
            {busy ? "Checking…" : "Log in"}
          </button>
        </form>
        <p className="subtle">
          Not an administrator? <Link to="/">Back to the public search</Link>
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- S8 Admin Dashboard

function DashboardView({ call }) {
  useDocumentTitle("Admin dashboard");
  const [status, setStatus] = useState(null);
  const [model, setModel] = useState(undefined);
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
    try {
      const diagnostics = await call(api.admin.diagnostics);
      if (diagnostics) setModel(diagnostics);
    } catch {
      setModel(null);
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
      <PageHeader eyebrow="Administrator" title="Dashboard" subtitle="Dataset health, data updates and the price model." />

      {error && (
        <Alert kind="error" title="Couldn't load the dataset status">
          {error.message}
        </Alert>
      )}

      <div className="stat-grid cols-4">
        <StatTile
          icon={Database}
          label="Transactions stored"
          value={status ? formatCount(status.total_rows) : <Skeleton width={90} height={26} />}
        />
        <StatTile
          icon={CalendarRange}
          label="Coverage"
          small
          value={
            status ? (
              status.first_month ? `${formatMonth(status.first_month)} – ${formatMonth(status.latest_month)}` : "No data"
            ) : (
              <Skeleton width={140} height={20} />
            )
          }
        />
        <StatTile
          icon={Clock}
          label="Last data update"
          small
          value={
            status ? (
              status.last_successful_update ? formatDate(status.last_successful_update) : "Never"
            ) : (
              <Skeleton width={140} height={20} />
            )
          }
          hint={status?.last_successful_update ? `at ${formatTime(status.last_successful_update)}` : undefined}
        />
        <StatTile
          icon={Sigma}
          label="Model fit (R²)"
          value={model === undefined ? <Skeleton width={70} height={26} /> : model ? model.r_squared.toFixed(3) : "Not trained"}
          hint={model ? `Trained ${formatDate(model.fitted_at)}` : undefined}
        />
      </div>

      {status?.needs_attention?.length > 0 && (
        <Alert kind="warning" title="Needs attention">
          <ul>
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
        </Alert>
      )}

      <Card
        title="Data updates"
        description="New transactions are fetched from data.gov.sg every day at 03:00. You can also run the update now."
        actions={
          <button type="button" className="btn btn-primary" onClick={checkNow} disabled={checking}>
            {checking ? <Spinner /> : <RefreshCw size={16} aria-hidden="true" />}
            {checking ? "Checking data.gov.sg…" : "Check data.gov.sg now"}
          </button>
        }
      >
        {checkResult && (
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <Alert kind={checkResult.status === "success" ? "success" : "error"} title="data.gov.sg check">
              {checkResult.status === "success"
                ? `${formatCount(checkResult.rows_received)} recent records checked, ${formatCount(checkResult.rows_added)} new added${
                    checkResult.rows_rejected ? `, ${checkResult.rows_rejected} rejected` : ""
                  }${checkResult.model_retrained ? "; model retrained" : ""}.`
                : checkResult.message}
            </Alert>
          </div>
        )}
        {status?.recent_updates?.length ? (
          <div className="table-wrap" style={{ marginTop: checkResult ? 16 : 0 }}>
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
                  <tr key={`${run.recorded_at}-${run.source}-${run.status}-${run.filename || ""}`}>
                    <td className="num nowrap">{formatDateTime(run.recorded_at)}</td>
                    <td>
                      {run.source === "api" ? (
                        "data.gov.sg"
                      ) : (
                        <>
                          Upload
                          {run.filename && <span className="cell-sub">{run.filename}</span>}
                        </>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={run.status === "success" ? "success" : "danger"}
                        icon={run.status === "success" ? CheckCircle2 : AlertTriangle}
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td className="number">{run.rows_added == null ? "–" : formatCount(run.rows_added)}</td>
                    <td className="muted">{run.message || (run.rows_rejected ? `${run.rows_rejected} rejected` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card-body">
            <p className="muted">No updates recorded yet.</p>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- S9 Dataset Management / E4 / S9a

function DatasetView({ call, selectedFile, onSelectFile, onUpload, onCheck }) {
  useDocumentTitle("Dataset management");
  const [limitMb, setLimitMb] = useState(DEFAULT_UPLOAD_LIMIT_MB);
  const [rejection, setRejection] = useState(null);
  const [checked, setChecked] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  // Also confirms the session is still valid as soon as the page opens (expired -> S7).
  useEffect(() => {
    call(api.admin.status)
      .then((status) => status?.max_upload_mb && setLimitMb(status.max_upload_mb))
      .catch(() => {});
  }, [call]);

  function choose(file) {
    onSelectFile(file || null);
    setRejection(null);
    setChecked(null);
  }

  function clientCheck() {
    if (!selectedFile) return "Choose a .csv or .xlsx file first.";
    const extension = selectedFile.name.toLowerCase().split(".").pop();
    if (!["csv", "xlsx"].includes(extension)) return "Wrong file format. Upload a .csv or .xlsx file.";
    if (selectedFile.size > limitMb * 1024 * 1024) return `The file is larger than the ${limitMb} MB limit.`;
    return null;
  }

  async function run(kind) {
    const problem = clientCheck();
    if (problem) {
      setRejection({ message: problem });
      return;
    }
    setBusy(kind);
    setRejection(null);
    try {
      const result = await (kind === "check" ? onCheck() : onUpload());
      if (!result) return;
      if (kind === "check") setChecked(result);
      else setSummary(result);
    } catch (err) {
      setRejection({ message: err.message, details: err.details }); // E4
      setChecked(null);
    } finally {
      setBusy(null);
    }
  }

  function uploadAnother() {
    setSummary(null);
    setChecked(null);
    onSelectFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const header = (
    <PageHeader
      eyebrow="Administrator"
      title="Dataset management"
      subtitle="Add HDB resale transactions in the official data.gov.sg format. New rows are appended, rows already stored are skipped, and existing records are never changed."
    />
  );

  if (summary) {
    return (
      <>
        {header}
        <Card title="Import summary" aria-live="polite">
          <div className="card-body" style={{ display: "grid", gap: 18 }}>
            <Alert kind="success" title="Import complete">
              {summary.filename} was validated and imported.
            </Alert>
            <ul className="check-list">
              <li>
                <span>Rows in file</span>
                <strong className="num">{formatCount(summary.rows_received)}</strong>
              </li>
              <li>
                <span>New rows added</span>
                <strong className="num">{formatCount(summary.rows_added)}</strong>
              </li>
              <li>
                <span>Already stored (skipped)</span>
                <strong className="num">{formatCount(summary.duplicates_skipped)}</strong>
              </li>
              <li>
                <span>Months covered</span>
                <strong>
                  {formatMonth(summary.first_month)} – {formatMonth(summary.latest_month)}
                </strong>
              </li>
              <li>
                <span>Price model</span>
                <strong>{summary.model_retrained ? "Retrained on the updated data" : "Unchanged (no new rows)"}</strong>
              </li>
            </ul>
            <div>
              <span className="field-label">Accepted columns</span>
              <div className="columns-list" style={{ marginTop: 8 }}>
                {summary.accepted_columns.map((column) => (
                  <code key={column} className="code-chip">
                    {column}
                  </code>
                ))}
              </div>
            </div>
            {summary.ignored_columns?.length > 0 && (
              <Alert kind="info" title="Extra columns ignored">
                {summary.ignored_columns.join(", ")}
              </Alert>
            )}
          </div>
          <div className="card-footer form-actions">
            <button key="upload-another" type="button" className="btn btn-primary" onClick={uploadAnother}>
              <UploadCloud size={16} aria-hidden="true" />
              Upload another file
            </button>
            <Link className="btn" to="/admin">
              Back to dashboard
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <Card title="Upload a dataset" description={`.csv or .xlsx, up to ${limitMb} MB`}>
        <div className="card-body" style={{ display: "grid", gap: 16 }}>
          {rejection && (
            <Alert kind="error" title="Upload rejected">
              <p>{rejection.message}</p>
              {rejection.details?.missing_columns && (
                <p>
                  Missing columns: <strong>{rejection.details.missing_columns.join(", ")}</strong>
                </p>
              )}
              {rejection.details?.row_errors?.length > 0 && (
                <ul>
                  {rejection.details.row_errors.map((rowError) => (
                    <li key={rowError}>{rowError}</li>
                  ))}
                </ul>
              )}
              <p>Correct the file and try again.</p>
            </Alert>
          )}

          <label
            className={`dropzone${dragging ? " dragging" : ""}`}
            htmlFor="dataset-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files?.[0]);
            }}
          >
            <span className="empty-icon" aria-hidden="true">
              <UploadCloud size={24} />
            </span>
            <strong>Drag a file here, or click to choose</strong>
            <span className="subtle">CSV or Excel (.xlsx) in the data.gov.sg column format</span>
            <input
              ref={inputRef}
              id="dataset-file"
              type="file"
              accept=".csv,.xlsx"
              aria-label="Dataset file (.csv or .xlsx)"
              onChange={(event) => choose(event.target.files?.[0])}
            />
          </label>

          {selectedFile && (
            <div className="file-row">
              <FileSpreadsheet size={22} aria-hidden="true" />
              <div className="file-row-text">
                <strong>{selectedFile.name}</strong>
                <span>{fileSize(selectedFile.size)}</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(null)} aria-label="Remove file">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {checked && (
            <Alert kind="success" title="The file is valid and ready to import">
              <ul className="check-list" style={{ marginTop: 8 }}>
                <li>
                  <span>Rows</span>
                  <strong className="num">{formatCount(checked.rows_received)}</strong>
                </li>
                <li>
                  <span>Months covered</span>
                  <strong>
                    {formatMonth(checked.first_month)} – {formatMonth(checked.latest_month)}
                  </strong>
                </li>
                {checked.ignored_columns?.length > 0 && (
                  <li>
                    <span>Extra columns (ignored)</span>
                    <strong>{checked.ignored_columns.join(", ")}</strong>
                  </li>
                )}
              </ul>
            </Alert>
          )}
        </div>
        <div className="card-footer form-actions">
          <button type="button" className="btn" onClick={() => run("check")} disabled={Boolean(busy)}>
            {busy === "check" ? <Spinner /> : <FileCheck2 size={16} aria-hidden="true" />}
            Check file
          </button>
          <button type="button" className="btn btn-primary" onClick={() => run("import")} disabled={Boolean(busy)}>
            {busy === "import" ? <Spinner /> : <UploadCloud size={16} aria-hidden="true" />}
            {busy === "import" ? "Validating and importing…" : "Upload"}
          </button>
        </div>
      </Card>

      <Card title="Required columns" description="Column names are not case-sensitive. Extra columns are ignored.">
        <div className="card-body columns-list">
          {REQUIRED_COLUMNS.map((column) => (
            <code key={column} className="code-chip">
              {column}
            </code>
          ))}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- S10 Model Diagnostics

const GROUP_PATTERN = /^(Town|Flat type|Storey range|Flat model): (.+) \(vs (.+)\)$/;

/** Category levels read the same as on the public pages ("Ang Mo Kio", "4-room", "01 to 03"). */
function levelLabel(group, level) {
  if (group === "Town") return titleCase(level);
  if (group === "Flat type") return flatTypeLabel(level);
  if (group === "Storey range") return level.toLowerCase();
  return level;
}

function groupCoefficients(diagnostics, filter) {
  const needle = filter.trim().toLowerCase();
  const groups = new Map();
  Object.entries(diagnostics.coefficients).forEach(([name, value]) => {
    if (needle && !name.toLowerCase().includes(needle)) return;
    const match = GROUP_PATTERN.exec(name);
    const key = match ? `${match[1]} (compared with ${levelLabel(match[1], match[3])})` : "Intercept and numeric features";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name, label: match ? levelLabel(match[1], match[2]) : name, value, p: diagnostics.p_values[name] });
  });
  return [...groups.entries()];
}

function DiagnosticsView({ onLoad }) {
  useDocumentTitle("Model diagnostics");
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

  const groups = useMemo(() => (diagnostics ? groupCoefficients(diagnostics, filter) : []), [diagnostics, filter]);

  return (
    <>
      <PageHeader
        eyebrow="Administrator"
        title="Model diagnostics"
        subtitle="Ordinary least squares fit of resale price on town, flat type, storey range, flat model, floor area and lease commencement year (in-sample)."
      />

      {error && (
        <Alert
          kind="error"
          title={error.status === 503 ? "Model unavailable" : "Couldn't load diagnostics"}
          action={
            <button type="button" className="btn btn-sm" onClick={load}>
              Retry
            </button>
          }
        >
          {error.message} {error.status === 503 && "Diagnostics will be available once a model has been trained."}
        </Alert>
      )}

      {loading && !diagnostics && (
        <div className="stat-grid cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card stat">
              <Skeleton width="40%" />
              <Skeleton width="60%" height={26} />
            </div>
          ))}
        </div>
      )}

      {diagnostics && (
        <>
          <div className="stat-grid cols-4">
            <StatTile icon={Sigma} label="R²" value={diagnostics.r_squared.toFixed(4)} hint="Share of price variation explained" />
            <StatTile icon={Sigma} label="Adjusted R²" value={diagnostics.adjusted_r_squared.toFixed(4)} hint="Penalised for model size" />
            <StatTile icon={Activity} label="RMSE" value={formatSGD(diagnostics.rmse_sgd)} hint="Typical error (all price levels)" />
            <StatTile
              icon={Database}
              label="Training data"
              small
              value={`${formatCount(diagnostics.n_observations)} sales`}
              hint={`${formatMonth(diagnostics.training_from)} – ${formatMonth(diagnostics.training_to)} · trained ${formatDate(diagnostics.fitted_at)}`}
            />
          </div>
          <Card
            title="Coefficients and significance"
            description="Each category is compared with its most common level. Significance at the 5% level."
            actions={
              <div className="search-input">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  className="control"
                  aria-label="Filter coefficients"
                  placeholder="Filter, e.g. Town"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>
            }
          >
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
                  {groups.map(([group, rows]) => [
                    <tr key={group} className="group-row">
                      <th scope="colgroup" colSpan={4}>
                        {group}
                      </th>
                    </tr>,
                    ...rows.map((row) => (
                      <tr key={row.name}>
                        <td title={row.name}>{row.label}</td>
                        <td className="number">{formatSGD(row.value, { signed: row.name !== "Intercept" })}</td>
                        <td className="number">{row.p < 0.0001 ? "< 0.0001" : row.p.toFixed(4)}</td>
                        <td>
                          {row.p < 0.05 ? (
                            <Badge tone="success" icon={CheckCircle2}>
                              Yes
                            </Badge>
                          ) : (
                            <Badge>No</Badge>
                          )}
                        </td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
