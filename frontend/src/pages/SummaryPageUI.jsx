// <<boundary>> SummaryPageUI: dialog map S4 Summary Statistics Page.
// UC-4.4 View Summary Statistics (extends UC-4.1). Methods mirror the class diagram:
// change_period(), render_chart(). Attribute: stats (SummaryStatistics).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import Message from "../components/Message.jsx";
import PriceTrendChart from "../components/PriceTrendChart.jsx";
import { describeCriteria, formatSGD } from "../components/format.js";
import { useFilters } from "../state/FilterContext.jsx";

const PERIODS = [
  { value: "1y", label: "Last 12 months" },
  { value: "3y", label: "Last 3 years" },
  { value: "5y", label: "Last 5 years" },
  { value: "all", label: "Since 2017" },
];
const loadOptions = (town) => api.filterOptions(town);

export default function SummaryPageUI() {
  const { criteria, setCriteria } = useFilters();
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState("all");
  const [error, setError] = useState(null);
  const [filterErrors, setFilterErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const latestRequest = useRef(0);

  // Only the most recent request may update the page (a slow earlier period must not win).
  const load = useCallback(async (forCriteria, forPeriod) => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.summary(forCriteria, forPeriod);
      if (request !== latestRequest.current) return false;
      setStats(result);
      return true;
    } catch (err) {
      if (request !== latestRequest.current) return false;
      if (err.status === 400) setFilterErrors(err.fields);
      else setError(err);
      return false;
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (criteria.town) load(criteria, period);
  }, [criteria, period, load]);

  /** change_period(): recalculate for another time range (UC-4.4 AC.2). */
  const change_period = (next) => setPeriod(next);

  /** render_chart(): the labelled price trend graph (UC-4.4 steps 4-5). */
  const render_chart = () => <PriceTrendChart trend={stats.trend} />;

  // UC-4.4 AC.1: new criteria recalculate the statistics and graph.
  async function applyFilters(next) {
    setFilterErrors({});
    if (await load(next, period)) setCriteria(next);
  }

  if (!criteria.town) return <Navigate to="/" replace />;
  const periodLabel = PERIODS.find((p) => p.value === period)?.label.toLowerCase();

  return (
    <div className="page">
      <Link className="back-link" to="/results">
        ← Back to results
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Summary statistics</p>
          <h1>{describeCriteria(criteria)}</h1>
          <p className="muted">Calculated from actual resale transactions (historical values, not estimates).</p>
        </div>
      </header>

      <details className="panel filter-panel" open={Object.keys(filterErrors).length > 0}>
        <summary>Change filters</summary>
        <FilterForm value={criteria} errors={filterErrors} onApply={applyFilters} loadOptions={loadOptions} compact />
      </details>

      <div className="segmented" role="radiogroup" aria-label="Period">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={period === option.value}
            className={period === option.value ? "active" : ""}
            onClick={() => change_period(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <Message
          kind="error"
          title="Couldn't calculate the statistics"
          action={
            <button type="button" className="button" onClick={() => load(criteria, period)}>
              Try again
            </button>
          }
        >
          {error.message}
        </Message>
      )}
      {loading && !stats && <p className="muted">Calculating…</p>}

      {stats && stats.count === 0 && (
        <Message kind="info" title="No matching records found">
          No resale transactions match these filters in the {periodLabel}. Try a longer period or broader filters.
        </Message>
      )}

      {stats && stats.count > 0 && (
        <>
          <div className="stat-grid" aria-busy={loading}>
            <div className="stat">
              <span className="stat-label">Sales ({periodLabel})</span>
              <span className="stat-value">{stats.count.toLocaleString("en-SG")}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Mean resale price</span>
              <span className="stat-value">{formatSGD(stats.mean_sgd)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Median resale price</span>
              <span className="stat-value">{formatSGD(stats.median_sgd)}</span>
            </div>
          </div>
          <section className="panel">{render_chart()}</section>
        </>
      )}
    </div>
  );
}
