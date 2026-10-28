// <<boundary>> HomeSearchPageUI: dialog map S1 Search Filter Page and E1 Filter errors.
// UC-4.1 Select Housing Filters (with UC-4.7 validation). Methods mirror the class diagram:
// load_options(), apply_filters(). Attribute: criteria (FilterCriteria).
import { BarChart3, Calculator, ListChecks, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import Skyline from "../components/Skyline.jsx";
import { formatCount, formatDate, formatMonth } from "../components/format.js";
import { Alert } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

const FEATURES = [
  {
    icon: ListChecks,
    title: "See what flats really sold for",
    text: "The latest registered resale transactions that match your filters, with full details for every sale.",
  },
  {
    icon: BarChart3,
    title: "Understand the market",
    text: "Every sale since 2017, plus the median, mean and month-by-month price trend for the flats you care about.",
  },
  {
    icon: Calculator,
    title: "Estimate a fair price",
    text: "A transparent regression estimate that shows exactly how town, size, storey and lease move the price.",
  },
];

export default function HomeSearchPageUI() {
  useDocumentTitle(null);
  const { criteria: sharedCriteria, setCriteria } = useFilters();
  const navigate = useNavigate();
  const [criteria, setLocalCriteria] = useState(sharedCriteria);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const { dataInfo } = useOutletContext() || {};
  const [townCount, setTownCount] = useState(null);

  /** load_options(): towns; then flat types for the town; then storeys / models / areas (UC-4.1 steps 2-5). */
  const load_options = useCallback(async (town, flatType) => {
    const options = await api.filterOptions(town, flatType);
    if (!town) setTownCount(options.towns.length);
    return options;
  }, []);

  /** apply_filters(): guard "Valid filters?" -> E1 on this page, or S2 Latest Results. */
  async function apply_filters(next) {
    setLocalCriteria(next); // E1: inputs are retained for correction
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      await api.latest(next, 1);
      setCriteria(next);
      navigate("/results");
    } catch (error) {
      setErrors(error.fields || {});
      setMessage({
        kind: "error",
        title: error.status === 400 ? "Please check your filters" : "Search is temporarily unavailable",
        text: error.message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <Skyline />
        <div className="container hero-inner">
          <span className="hero-kicker">
            <ShieldCheck size={15} aria-hidden="true" />
            Official HDB resale transactions · updated daily
          </span>
          <h1>Know what an HDB flat is really worth.</h1>
          <p className="hero-lead">
            Search recent resale prices, explore how the market has moved since 2017, and get a transparent fair-price
            estimate for any flat in Singapore.
          </p>
          <div className="search-panel" aria-labelledby="search-heading">
            <div className="search-panel-head">
              <h2 id="search-heading">Find similar flats</h2>
              <span className="subtle">Start with a town</span>
            </div>
            {message && (
              <div style={{ marginBottom: 16 }}>
                <Alert kind={message.kind} title={message.title}>
                  {message.text}
                </Alert>
              </div>
            )}
            <FilterForm
              value={criteria}
              errors={errors}
              onApply={apply_filters}
              loadOptions={load_options}
              busy={busy}
              variant="hero"
              submitLabel="Show latest prices"
            />
          </div>
          <div className="hero-stats" aria-label="About the data">
            <div className="hero-stat">
              <span className="hero-stat-value">{dataInfo ? formatCount(dataInfo.total_rows) : "—"}</span>
              <span className="hero-stat-label">resale transactions</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{townCount ?? "—"}</span>
              <span className="hero-stat-label">HDB towns covered</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">
                {dataInfo ? `${formatMonth(dataInfo.first_month).slice(-4)}–${formatMonth(dataInfo.latest_month).slice(-4)}` : "—"}
              </span>
              <span className="hero-stat-label">
                {dataInfo ? `${formatMonth(dataInfo.first_month)} to ${formatMonth(dataInfo.latest_month)}` : "years of history"}
              </span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{dataInfo ? formatDate(dataInfo.last_successful_update) : "—"}</span>
              <span className="hero-stat-label">last updated from data.gov.sg</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container page">
        <div className="section-title">
          <p className="eyebrow">What you can do</p>
          <h2 style={{ fontSize: "1.5rem" }}>From recent sales to a fair price, in three steps</h2>
        </div>
        <div className="features">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card feature">
              <span className="feature-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <p className="subtle">
          Already know the flat?{" "}
          <Link to="/predict" state={{ from: "/" }}>
            Go straight to a price estimate
          </Link>
          .
        </p>
      </div>
    </>
  );
}
