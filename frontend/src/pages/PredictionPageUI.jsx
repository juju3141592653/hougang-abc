// <<boundary>> PredictionPageUI: dialog map S5 Prediction Input Page, E2 Prediction feedback and
// S6 Price and Breakdown. UC-4.5 View Fair Price Prediction with UC-4.6 View Prediction Breakdown
// (included: shown automatically) and UC-4.7 validation. Methods mirror the class diagram:
// submit_prediction(), show_price_and_breakdown(result). Attributes: inputs (PredictionInput),
// result (Prediction?).
// Pre-filled from the property opened on S2a (passed in the navigation state) or, from S2 / the
// header, from the search filters. "Back" returns to where the user came from (decisions #28).
import { Building2, Calculator, Info, Layers, MapPin, Pencil, Ruler, Shapes, Sparkles, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import BreakdownChart from "../components/BreakdownChart.jsx";
import PriceRange from "../components/PriceRange.jsx";
import { flatTypeLabel, formatSGD, titleCase } from "../components/format.js";
import { backTarget } from "../components/navigation.js";
import { Alert, BackLink, Badge, FieldError, PageHeader, Spinner } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

const FIELDS = ["town", "flat_type", "storey_range", "flat_model", "floor_area_sqm", "lease_commence_date"];

function initialInputs(record, criteria) {
  // S5 "Pre-fill from selected property"; otherwise from the UC-4.1 filters (UC-4.5 step 2).
  const source = record || criteria || {};
  return Object.fromEntries(FIELDS.map((field) => [field, source[field] == null ? "" : String(source[field])]));
}

const HOW_IT_WORKS = [
  ["Recent sales", "An ordinary least squares regression fitted to every HDB resale registered in the last 24 months."],
  ["Your flat's features", "Town, flat type, storey range, flat model, floor area and lease start year each move the price up or down."],
  ["A transparent result", "You see the average recent price, the effect of each feature, and a likely range."],
  ["No guessing", "If fewer than 30 recent sales share one of the flat's features, we say so instead of estimating."],
];

export default function PredictionPageUI() {
  const { criteria } = useFilters();
  const location = useLocation();
  const record = location.state?.record || null;
  const back = backTarget(location, criteria);
  const [inputs, setInputs] = useState(() => initialInputs(record, criteria));
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState(null);
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(result ? "Your estimate" : "Price estimate");

  useEffect(() => {
    api
      .filterOptions("")
      .then(setOptions)
      .catch((err) => setFeedback({ kind: "error", title: "The form could not be loaded", text: err.message }));
  }, []);

  /** submit_prediction(): guard "Valid inputs + enough data?" -> S6, or E2 on this page. */
  async function submit_prediction(event) {
    event?.preventDefault();
    setBusy(true);
    setErrors({});
    setFeedback(null);
    try {
      setResult(await api.predict(inputs));
      window.scrollTo?.(0, 0);
    } catch (err) {
      setErrors(err.fields || {});
      if (err.status === 422) {
        setFeedback({ kind: "warning", title: "Not enough data for a reliable estimate", text: err.message });
      } else if (err.status === 400) {
        setFeedback({ kind: "error", title: "Please check the property details", text: err.message });
      } else {
        setFeedback({ kind: "error", title: "The estimate is temporarily unavailable", text: err.message, retry: true });
      }
    } finally {
      setBusy(false);
    }
  }

  /** show_price_and_breakdown(result): S6 with the automatic breakdown (UC-4.6). */
  function show_price_and_breakdown(prediction) {
    return (
      <section className="card" aria-live="polite" aria-labelledby="estimate-heading">
        <div className="estimate-hero">
          <span className="estimate-label" id="estimate-heading">
            <Sparkles size={16} aria-hidden="true" />
            Estimated current fair price
          </span>
          <span className="estimate-value price-hero">{formatSGD(prediction.estimated_price_sgd)}</span>
          <div className="estimate-for">
            <Badge icon={Building2}>{flatTypeLabel(inputs.flat_type)}</Badge>
            <Badge icon={MapPin}>{titleCase(inputs.town)}</Badge>
            <Badge icon={Layers}>Storey {inputs.storey_range.toLowerCase()}</Badge>
            <Badge icon={Shapes}>{inputs.flat_model}</Badge>
            <Badge icon={Ruler}>{inputs.floor_area_sqm} sqm</Badge>
            <Badge icon={CalendarDays}>Lease from {inputs.lease_commence_date}</Badge>
          </div>
          <PriceRange estimate={prediction.estimated_price_sgd} typicalError={prediction.typical_error_sgd} />
          {prediction.reliability_warning && (
            <Alert kind="warning" title="Less reliable estimate">
              {prediction.reliability_warning}
            </Alert>
          )}
        </div>
        <div className="breakdown-section">
          <div className="breakdown-head">
            <h2>How we got to this estimate</h2>
            {prediction.breakdown_available && (
              <div className="breakdown-legend" aria-hidden="true">
                <span>
                  <span className="legend-key up" /> Raises the price
                </span>
                <span>
                  <span className="legend-key down" /> Lowers the price
                </span>
              </div>
            )}
          </div>
          {prediction.breakdown_available ? (
            <BreakdownChart
              basePrice={prediction.base_price_sgd}
              breakdown={prediction.breakdown}
              estimate={prediction.estimated_price_sgd}
            />
          ) : (
            <Alert kind="info" title="Breakdown temporarily unavailable">
              The estimated price is shown, but the feature-by-feature breakdown can't be displayed right now.
            </Alert>
          )}
        </div>
        <p className="disclaimer">
          <Info size={15} aria-hidden="true" />
          <span>
            This is a statistical estimate from a linear regression on recent HDB resale transactions. It is not an
            official valuation, not a guaranteed market price, and not financial advice.
          </span>
        </p>
        <div className="result-actions">
          <button type="button" className="btn btn-primary" onClick={() => setResult(null)}>
            <Pencil size={16} aria-hidden="true" />
            Change inputs / predict again
          </button>
          <Link className="btn" to={back.to}>
            {back.label}
          </Link>
        </div>
      </section>
    );
  }

  const change = (field) => (event) => setInputs({ ...inputs, [field]: event.target.value });
  const select = (field, label, list, render = (v) => v) => (
    <div className="field">
      <label htmlFor={`predict-${field}`}>{label}</label>
      <select
        id={`predict-${field}`}
        className="control"
        value={inputs[field]}
        onChange={change(field)}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? `predict-${field}-error` : undefined}
      >
        <option value="">Select…</option>
        {(list || []).map((item) => (
          <option key={item} value={item}>
            {render(item)}
          </option>
        ))}
      </select>
      <FieldError id={`predict-${field}-error`} message={errors[field]} />
    </div>
  );

  return (
    <div className="container page">
      <BackLink to={back.to} label={back.label} />
      <PageHeader
        eyebrow="Fair price estimate"
        title={result ? "Your estimate" : "Estimate a flat's current fair price"}
        subtitle="Based on every HDB resale transaction registered in the last 24 months."
      />

      {feedback && (
        <Alert
          kind={feedback.kind}
          title={feedback.title}
          action={
            feedback.retry && (
              <button type="button" className="btn btn-sm" onClick={submit_prediction}>
                Try again
              </button>
            )
          }
        >
          {feedback.text}
        </Alert>
      )}

      <div className="predict-layout">
        <div>
          {result ? (
            show_price_and_breakdown(result)
          ) : (
            <form className="card" onSubmit={submit_prediction} noValidate aria-labelledby="property-heading">
              <div className="card-header">
                <div>
                  <h2 id="property-heading">Confirm the property's features</h2>
                  <p>All six features are needed for an estimate.</p>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 18 }}>
                {record ? (
                  <p className="prefill-note">
                    <Info size={16} aria-hidden="true" />
                    <span>
                      Pre-filled from Blk {record.block} {titleCase(record.street_name)}. Adjust anything that differs
                      for the flat you have in mind.
                    </span>
                  </p>
                ) : (
                  criteria.town && (
                    <p className="prefill-note">
                      <Info size={16} aria-hidden="true" />
                      <span>Pre-filled from your search. Complete the remaining features.</span>
                    </p>
                  )
                )}
                <div className="form-grid">
                  {select("town", "Town", options?.towns, titleCase)}
                  {select("flat_type", "Flat type", options?.flat_types, flatTypeLabel)}
                  {select("storey_range", "Storey range", options?.storey_ranges, (s) => s.toLowerCase())}
                  {select("flat_model", "Flat model", options?.flat_models)}
                  <div className="field">
                    <label htmlFor="predict-floor_area_sqm">Floor area</label>
                    <div className="input-affix">
                      <input
                        id="predict-floor_area_sqm"
                        className="control"
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 93"
                        value={inputs.floor_area_sqm}
                        onChange={change("floor_area_sqm")}
                        aria-invalid={Boolean(errors.floor_area_sqm)}
                      />
                      <span className="affix">sqm</span>
                    </div>
                    <FieldError message={errors.floor_area_sqm} />
                  </div>
                  <div className="field">
                    <label htmlFor="predict-lease_commence_date">Lease commencement year</label>
                    <input
                      id="predict-lease_commence_date"
                      className="control"
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g. 1995"
                      value={inputs.lease_commence_date}
                      onChange={change("lease_commence_date")}
                      aria-invalid={Boolean(errors.lease_commence_date)}
                    />
                    <FieldError message={errors.lease_commence_date} />
                  </div>
                </div>
              </div>
              <div className="card-footer form-actions">
                <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                  {busy ? <Spinner /> : <Calculator size={18} aria-hidden="true" />}
                  {busy ? "Estimating…" : "Predict price"}
                </button>
              </div>
            </form>
          )}
        </div>
        <aside className="card aside-card" aria-labelledby="how-heading">
          <div className="card-header">
            <h2 id="how-heading">How this estimate works</h2>
          </div>
          <div className="card-body">
            <ol className="how-list">
              {HOW_IT_WORKS.map(([title, text], index) => (
                <li key={title}>
                  <span className="how-step">{index + 1}</span>
                  <span>
                    <strong>{title}</strong>
                    {text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
