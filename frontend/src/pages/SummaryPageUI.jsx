// <<boundary>> SummaryPageUI: dialog map S4 Summary Statistics Page.
// UC-4.4 View Summary Statistics (extends UC-4.1). Methods mirror the class diagram:
// change_period(), render_chart(). Attribute: stats (SummaryStatistics).
// "Back" returns to the page this was opened from, S2 or S2a (decisions #28).
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, Coins, Hash, Ruler, SearchX, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import PriceTrendChart from "../components/PriceTrendChart.jsx";
import { criteriaChips, describeCriteria, formatCount, formatMonth, formatPercent, formatSGD } from "../components/format.js";
import { backTarget } from "../components/navigation.js";
import { Alert, BackLink, Badge, Card, EmptyState, PageHeader, Skeleton, StatTile } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

const PERIODS = [
  { value: "1y", label: "12 months" },
  { value: "3y", label: "3 years" },
  { value: "5y", label: "5 years" },
  { value: "all", label: "Since 2017" },
];
const loadOptions = (town, flatType) => api.filterOptions(town, flatType);

/** Change in the median from the first three months of the period to the last three (averaged to smooth one-off months). */
function medianChange(trend) {
  const months = Object.keys(trend || {});
  if (months.length < 6) return null;
  const avg = (list) => list.reduce((sum, m) => sum + trend[m], 0) / list.length;
  const start = avg(months.slice(0, 3));
  const end = avg(months.slice(-3));
  return { pct: ((end - start) / start) * 100 };
}

export default function SummaryPageUI() {
  const { criteria, setCriteria } = useFilters();
  const location = useLocation();
  const back = backTarget(location, criteria);
  useDocumentTitle(criteria.town ? `Market summary · ${describeCriteria(criteria)}` : "Market summary");
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

  /** render_chart(): the labelled price trend and sales volume (UC-4.4 steps 4-5). */
  const render_chart = () => <PriceTrendChart trend={stats.trend} volume={stats.volume} />;

  // UC-4.4 AC.1: new criteria recalculate the statistics and graph.
  async function applyFilters(next) {
    setFilterErrors({});
    if (await load(next, period)) setCriteria(next);
  }

  if (!criteria.town) return <Navigate to="/" replace />;
  const periodLabel = PERIODS.find((p) => p.value === period)?.label;
  const change = stats ? medianChange(stats.trend) : null;
  const chips = criteriaChips(criteria);

  return (
    <div className="container page">
      <BackLink to={back.to} label={back.label} />
      <PageHeader
        eyebrow="Market summary"
        title={describeCriteria(criteria)}
        subtitle="Calculated from actual resale transactions. These are historical values, not estimates."
      >
        {chips.length > 0 && (
          <div className="chip-row">
            {chips.map((chip) => (
              <Badge key={chip}>{chip}</Badge>
            ))}
          </div>
        )}
      </PageHeader>

      <details className="card collapsible" open={Object.keys(filterErrors).length > 0}>
        <summary>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Refine filters
          <ChevronDown size={18} className="chevron" aria-hidden="true" />
        </summary>
        <div className="collapsible-body">
          <FilterForm value={criteria} errors={filterErrors} onApply={applyFilters} loadOptions={loadOptions} />
        </div>
      </details>

      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={period === option.value}
              onClick={() => change_period(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {stats?.count > 0 && (
          <span className="subtle">
            {formatMonth(Object.keys(stats.trend)[0])} – {formatMonth(Object.keys(stats.trend).at(-1))}
          </span>
        )}
      </div>

      {error && (
        <Alert
          kind="error"
          title="Couldn't calculate the statistics"
          action={
            <button type="button" className="btn btn-sm" onClick={() => load(criteria, period)}>
              Try again
            </button>
          }
        >
          {error.message}
        </Alert>
      )}

      {!stats && loading && (
        <div className="stat-grid cols-5" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="card stat">
              <Skeleton width="50%" />
              <Skeleton width="70%" height={26} />
            </div>
          ))}
        </div>
      )}

      {stats && stats.count === 0 && (
        <div className="card">
          <EmptyState icon={SearchX} title="No matching records found">
            No resale transactions match these filters in the selected period ({periodLabel}). Try a longer period
            or broader filters.
          </EmptyState>
        </div>
      )}

      {stats && stats.count > 0 && (
        <>
          <div className="stat-grid cols-5" aria-busy={loading}>
            <StatTile icon={Hash} label="Number of sales" value={formatCount(stats.count)} hint={periodLabel} />
            <StatTile icon={Coins} label="Median price" value={formatSGD(stats.median_sgd)} hint="Half sold for less" />
            <StatTile icon={BarChart3} label="Average price" value={formatSGD(stats.mean_sgd)} hint="Mean of all sales" />
            <StatTile icon={Ruler} label="Median per sqm" value={formatSGD(stats.median_psm_sgd)} hint="Price ÷ floor area" />
            {change && (
              <StatTile
                icon={change.pct >= 0 ? ArrowUpRight : ArrowDownRight}
                label="Change in median"
                value={formatPercent(change.pct)}
                hint="Last 3 months vs first 3 months"
              />
            )}
          </div>
          <Card title="Price trend" description="Monthly median resale price, with the number of sales behind each month">
            {render_chart()}
          </Card>
        </>
      )}
    </div>
  );
}
