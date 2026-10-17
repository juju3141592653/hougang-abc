// <<boundary>> HistoricalDataPageUI: dialog map S3 Historical Data Page.
// UC-4.3 View Historical Data (extends UC-4.1). Methods mirror the class diagram:
// load_history(page), change_page(page), show_record_details(id). Attributes: criteria, page.
// Record details expand in place (docs/decisions.md #9); changing filters refreshes the table.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import Message from "../components/Message.jsx";
import Pagination from "../components/Pagination.jsx";
import { describeCriteria, formatArea, formatLease, formatMonth, formatSGD, titleCase } from "../components/format.js";
import { useFilters } from "../state/FilterContext.jsx";

const loadOptions = (town) => api.filterOptions(town);

export default function HistoricalDataPageUI() {
  const { criteria, setCriteria } = useFilters();
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [filterErrors, setFilterErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const latestRequest = useRef(0);

  /** load_history(page): all matching historical transactions, newest first (UC-4.3 steps 2-3). */
  const load_history = useCallback(
    async (pageNumber = 1, forCriteria = criteria) => {
      const request = ++latestRequest.current; // only the newest page / filter request may win
      setLoading(true);
      setError(null);
      try {
        const result = await api.history(forCriteria, pageNumber);
        if (request !== latestRequest.current) return false;
        setPage(result);
        setExpanded({});
        return true;
      } catch (err) {
        if (request !== latestRequest.current) return false;
        if (err.status === 400) setFilterErrors(err.fields);
        else setError(err);
        return false;
      } finally {
        if (request === latestRequest.current) setLoading(false);
      }
    },
    [criteria],
  );

  useEffect(() => {
    if (criteria.town) load_history(1);
  }, [criteria, load_history]);

  /** change_page(page): move through the paginated table. */
  const change_page = (pageNumber) => load_history(pageNumber);

  /** show_record_details(id): expand the row with the full record. */
  async function show_record_details(id) {
    if (expanded[id]) {
      setExpanded(({ [id]: _closed, ...rest }) => rest);
      return;
    }
    setExpanded((current) => ({ ...current, [id]: { loading: true } }));
    try {
      const record = await api.transaction(id);
      setExpanded((current) => ({ ...current, [id]: { record } }));
    } catch (err) {
      setExpanded((current) => ({ ...current, [id]: { error: err.message } }));
    }
  }

  // UC-4.3 AC.1: changing filters re-queries without leaving the page; shared state keeps them.
  async function applyFilters(next) {
    setFilterErrors({});
    if (await load_history(1, next)) setCriteria(next);
  }

  if (!criteria.town) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <Link className="back-link" to="/results">
        ← Back to results
      </Link>
      <header className="page-header">
        <div>
          <p className="eyebrow">Historical data</p>
          <h1>{describeCriteria(criteria)}</h1>
          <p className="muted">Every matching resale transaction since January 2017, newest first.</p>
        </div>
      </header>

      <details className="panel filter-panel" open={Object.keys(filterErrors).length > 0}>
        <summary>Change filters</summary>
        <FilterForm value={criteria} errors={filterErrors} onApply={applyFilters} loadOptions={loadOptions} compact />
      </details>

      {error && (
        <Message kind="error" title="Couldn't load historical data">
          {error.message}
        </Message>
      )}
      {loading && !page && <p className="muted">Loading…</p>}

      {page && page.total === 0 && (
        <Message kind="info" title="No matching records found">
          No resale transactions match these filters. Try removing a filter or choosing another town.
        </Message>
      )}

      {page && page.total > 0 && (
        <>
          <p className="result-count">{page.total.toLocaleString("en-SG")} transactions</p>
          <div className="table-wrap" aria-busy={loading}>
            <table className="table history-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Address</th>
                  <th scope="col">Flat type</th>
                  <th scope="col">Storey</th>
                  <th scope="col" className="number">
                    Floor area
                  </th>
                  <th scope="col">Remaining lease</th>
                  <th scope="col" className="number">
                    Resale price
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.records.map((record) => {
                  const detail = expanded[record.id];
                  return (
                    <Fragment key={record.id}>
                      <tr>
                        <td>{formatMonth(record.transaction_month)}</td>
                        <td>
                          Blk {record.block} {titleCase(record.street_name)}
                        </td>
                        <td>{titleCase(record.flat_type)}</td>
                        <td>{record.storey_range.toLowerCase()}</td>
                        <td className="number">{formatArea(record.floor_area_sqm)}</td>
                        <td>{formatLease(record.remaining_lease_years)}</td>
                        <td className="number">{formatSGD(record.resale_price_sgd)}</td>
                        <td>
                          <button
                            type="button"
                            className="button button-small"
                            onClick={() => show_record_details(record.id)}
                            aria-expanded={Boolean(detail)}
                          >
                            {detail ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {detail && (
                        <tr className="detail-row">
                          <td colSpan={8}>
                            {detail.loading && "Loading…"}
                            {detail.error && <span className="field-error">{detail.error}</span>}
                            {detail.record && (
                              <dl className="facts">
                                <div>
                                  <dt>Town</dt>
                                  <dd>{titleCase(detail.record.town)}</dd>
                                </div>
                                <div>
                                  <dt>Flat model</dt>
                                  <dd>{detail.record.flat_model}</dd>
                                </div>
                                <div>
                                  <dt>Lease commenced</dt>
                                  <dd>{detail.record.lease_commence_date}</dd>
                                </div>
                                <div>
                                  <dt>Price per sqm</dt>
                                  <dd>{formatSGD(detail.record.resale_price_sgd / detail.record.floor_area_sqm)}</dd>
                                </div>
                                <div>
                                  <dt>More</dt>
                                  <dd>
                                    <Link to={`/results/${detail.record.id}`}>Open this transaction</Link>
                                  </dd>
                                </div>
                              </dl>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page.page} totalPages={page.total_pages} onChange={change_page} />
        </>
      )}
    </div>
  );
}
