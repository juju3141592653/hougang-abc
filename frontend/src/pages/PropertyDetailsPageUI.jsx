// <<boundary>> PropertyDetailsPageUI: dialog map S2a Property Details Page.
// UC-4.2 AC.1 (full details of the selected transaction) and the entry point to UC-4.3, UC-4.4 and
// UC-4.5. Methods mirror the class diagram: load_record(id), open_history(), open_summary(),
// open_prediction(). Attributes: selected_record (Transaction), criteria (FilterCriteria).
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import Message from "../components/Message.jsx";
import { describeCriteria, formatArea, formatLease, formatMonth, formatSGD, titleCase } from "../components/format.js";
import { useFilters } from "../state/FilterContext.jsx";

export default function PropertyDetailsPageUI() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { criteria, setCriteria, setSelectedRecord } = useFilters();
  const [selected_record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  /** load_record(id): fetch the transaction (UC-4.2 AC.1). */
  const load_record = useCallback(async (recordId) => {
    setError(null);
    try {
      setRecord(await api.transaction(recordId));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load_record(id);
  }, [id, load_record]);

  // "Keep selected housing criteria": if the page was opened directly, fall back to the record's town.
  const ensureCriteria = () => {
    if (!criteria.town && selected_record) {
      setCriteria({ town: selected_record.town, flat_type: selected_record.flat_type });
    }
  };

  /** open_history(): S3 Historical Data Page (UC-4.3). */
  const open_history = () => {
    ensureCriteria();
    navigate("/history");
  };

  /** open_summary(): S4 Summary Statistics Page (UC-4.4). */
  const open_summary = () => {
    ensureCriteria();
    navigate("/summary");
  };

  /** open_prediction(): S5 Prediction Input Page, pre-filled from this property (UC-4.5 step 2). */
  const open_prediction = () => {
    ensureCriteria();
    setSelectedRecord(selected_record);
    navigate("/predict");
  };

  return (
    <div className="page">
      <Link className="back-link" to="/results">
        ← Back to results
      </Link>

      {error && (
        <Message kind="error" title="Couldn't load this transaction">
          {error.message}
        </Message>
      )}
      {!selected_record && !error && <p className="muted">Loading…</p>}

      {selected_record && (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">Resale transaction · {formatMonth(selected_record.transaction_month)}</p>
              <h1>
                Blk {selected_record.block} {titleCase(selected_record.street_name)}
              </h1>
              <p className="muted">
                {titleCase(selected_record.flat_type)} in {titleCase(selected_record.town)}
              </p>
            </div>
            <div className="price-block">
              <span className="price price-large">{formatSGD(selected_record.resale_price_sgd)}</span>
              <span className="muted">Resale price (actual sale)</span>
            </div>
          </header>

          <section className="panel">
            <h2>Transaction details</h2>
            <dl className="detail-list">
              <div>
                <dt>Month registered</dt>
                <dd>{formatMonth(selected_record.transaction_month)}</dd>
              </div>
              <div>
                <dt>Town</dt>
                <dd>{titleCase(selected_record.town)}</dd>
              </div>
              <div>
                <dt>Flat type</dt>
                <dd>{titleCase(selected_record.flat_type)}</dd>
              </div>
              <div>
                <dt>Flat model</dt>
                <dd>{selected_record.flat_model}</dd>
              </div>
              <div>
                <dt>Storey range</dt>
                <dd>{selected_record.storey_range.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Floor area</dt>
                <dd>{formatArea(selected_record.floor_area_sqm)}</dd>
              </div>
              <div>
                <dt>Lease commenced</dt>
                <dd>{selected_record.lease_commence_date}</dd>
              </div>
              <div>
                <dt>Remaining lease at sale</dt>
                <dd>{formatLease(selected_record.remaining_lease_years)}</dd>
              </div>
              <div>
                <dt>Price per sqm</dt>
                <dd>{formatSGD(selected_record.resale_price_sgd / selected_record.floor_area_sqm)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2>Explore further</h2>
            {criteria.town && <p className="muted">Using your search: {describeCriteria(criteria)}</p>}
            <div className="action-grid">
              <button type="button" className="button action" onClick={open_history}>
                <strong>View historical data</strong>
                <span>All matching sales since 2017</span>
              </button>
              <button type="button" className="button action" onClick={open_summary}>
                <strong>View summary</strong>
                <span>Mean, median and the price trend</span>
              </button>
              <button type="button" className="button action button-primary" onClick={open_prediction}>
                <strong>View prediction</strong>
                <span>Estimate a fair price for this flat</span>
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
