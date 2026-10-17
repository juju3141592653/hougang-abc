// <<boundary>> HomeSearchPageUI: dialog map S1 Search Filter Page and E1 Filter errors.
// UC-4.1 Select Housing Filters (with UC-4.7 validation). Methods mirror the class diagram:
// load_options(), apply_filters(). Attribute: criteria (FilterCriteria).
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import Message from "../components/Message.jsx";
import { useFilters } from "../state/FilterContext.jsx";

export default function HomeSearchPageUI() {
  const { criteria: sharedCriteria, setCriteria } = useFilters();
  const navigate = useNavigate();
  const [criteria, setLocalCriteria] = useState(sharedCriteria);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  /** load_options(): towns, then the flat types / storeys / models / areas in the chosen town. */
  const load_options = useCallback((town) => api.filterOptions(town), []);

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
    <div className="page page-home">
      <section className="hero">
        <h1>What are HDB flats really selling for?</h1>
        <p className="lead">
          Search official HDB resale transactions, explore price history and trends, and get a fair-price estimate
          with a clear breakdown of what drives it.
        </p>
      </section>

      <section className="panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Find similar flats</h2>
        <p className="muted">Choose a town to start. The other filters are optional.</p>
        {message && (
          <Message kind={message.kind} title={message.title}>
            {message.text}
          </Message>
        )}
        <FilterForm
          value={criteria}
          errors={errors}
          onApply={apply_filters}
          loadOptions={load_options}
          busy={busy}
          submitLabel="Show latest prices"
        />
      </section>

      <section className="steps" aria-label="What you can do">
        <div className="step">
          <span className="step-number">1</span>
          <h3>See recent sales</h3>
          <p>The latest resale transactions that match your filters, newest first.</p>
        </div>
        <div className="step">
          <span className="step-number">2</span>
          <h3>Explore history</h3>
          <p>Every matching sale since 2017, plus mean, median and the price trend.</p>
        </div>
        <div className="step">
          <span className="step-number">3</span>
          <h3>Estimate a fair price</h3>
          <p>A linear-regression estimate showing how each feature adds to or lowers the price.</p>
        </div>
      </section>
    </div>
  );
}
