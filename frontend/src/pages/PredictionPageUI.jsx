// <<boundary>> PredictionPageUI: dialog map S5 Prediction Input Page, E2 Prediction feedback and
// S6 Price and Breakdown. UC-4.5 View Fair Price Prediction with UC-4.6 View Prediction Breakdown
// (included: shown automatically) and UC-4.7 validation. Methods mirror the class diagram:
// submit_prediction(), show_price_and_breakdown(result). Attributes: inputs (PredictionInput),
// result (Prediction?).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import BreakdownTable from "../components/BreakdownTable.jsx";
import Message, { FieldError } from "../components/Message.jsx";
import { formatSGD, titleCase } from "../components/format.js";
import { useFilters } from "../state/FilterContext.jsx";

const FIELDS = ["town", "flat_type", "storey_range", "flat_model", "floor_area_sqm", "lease_commence_date"];

function initialInputs(selectedRecord, criteria) {
  // S5 "Pre-fill from selected property"; otherwise from the UC-4.1 filters (UC-4.5 step 2).
  const source = selectedRecord || criteria || {};
  return Object.fromEntries(FIELDS.map((field) => [field, source[field] == null ? "" : String(source[field])]));
}

export default function PredictionPageUI() {
  const { criteria, selectedRecord } = useFilters();
  const [inputs, setInputs] = useState(() => initialInputs(selectedRecord, criteria));
  const [result, setResult] = useState(null);
  const [options, setOptions] = useState(null);
  const [errors, setErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

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
      <section className="panel prediction-result" aria-live="polite">
        <p className="eyebrow">Estimated current fair price</p>
        <p className="price price-hero">{formatSGD(prediction.estimated_price_sgd)}</p>
        <p className="muted">
          For a {titleCase(inputs.flat_type)} {inputs.flat_model} flat in {titleCase(inputs.town)}, storey{" "}
          {inputs.storey_range.toLowerCase()}, {inputs.floor_area_sqm} sqm, lease from {inputs.lease_commence_date}.
        </p>
        {prediction.reliability_warning && (
          <Message kind="warning" title="Less reliable estimate">
            {prediction.reliability_warning}
          </Message>
        )}
        {prediction.breakdown_available ? (
          <BreakdownTable
            basePrice={prediction.base_price_sgd}
            breakdown={prediction.breakdown}
            estimate={prediction.estimated_price_sgd}
          />
        ) : (
          <Message kind="info" title="Breakdown temporarily unavailable">
            The estimated price is shown, but the feature-by-feature breakdown can't be displayed right now.
          </Message>
        )}
        <p className="disclaimer">
          This is a statistical estimate from a linear regression on recent HDB resale transactions. It is not an
          official valuation, not a guaranteed market price, and not financial advice.
        </p>
        <div className="form-actions">
          <button type="button" className="button button-primary" onClick={() => setResult(null)}>
            Change inputs / predict again
          </button>
          <Link className="button" to="/results">
            Back to results
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
    <div className="page">
      <Link className="back-link" to="/results">
        ← Back to results
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Fair price prediction</p>
          <h1>Estimate a flat's current resale price</h1>
        </div>
      </header>

      {feedback && (
        <Message
          kind={feedback.kind}
          title={feedback.title}
          action={
            feedback.retry && (
              <button type="button" className="button" onClick={submit_prediction}>
                Try again
              </button>
            )
          }
        >
          {feedback.text}
        </Message>
      )}

      {result ? (
        show_price_and_breakdown(result)
      ) : (
        <form className="panel" onSubmit={submit_prediction} noValidate>
          <h2>Confirm the property's features</h2>
          {selectedRecord ? (
            <p className="muted">
              Pre-filled from Blk {selectedRecord.block} {titleCase(selectedRecord.street_name)}. Adjust anything that
              differs for the flat you have in mind.
            </p>
          ) : (
            <p className="muted">All six features are needed for an estimate.</p>
          )}
          <div className="filter-grid">
            {select("town", "Town", options?.towns, titleCase)}
            {select("flat_type", "Flat type", options?.flat_types, titleCase)}
            {select("storey_range", "Storey range", options?.storey_ranges, (s) => s.toLowerCase())}
            {select("flat_model", "Flat model", options?.flat_models)}
            <div className="field">
              <label htmlFor="predict-floor_area_sqm">Floor area (sqm)</label>
              <input
                id="predict-floor_area_sqm"
                type="text"
                inputMode="decimal"
                value={inputs.floor_area_sqm}
                onChange={change("floor_area_sqm")}
                aria-invalid={Boolean(errors.floor_area_sqm)}
              />
              <FieldError message={errors.floor_area_sqm} />
            </div>
            <div className="field">
              <label htmlFor="predict-lease_commence_date">Lease commencement year</label>
              <input
                id="predict-lease_commence_date"
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
          <div className="form-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Estimating…" : "Predict"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
