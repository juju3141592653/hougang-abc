// <<boundary>> HistoricalDataPageUI: dialog map S3 Historical Data Page.
// UC-4.3 View Historical Data (extends UC-4.1). Methods mirror the class diagram:
// load_history(page), change_page(page), show_record_details(id). Attributes: criteria, page.
// Record details expand in place (decisions #9); changing filters refreshes the table (AC.1);
// "Back" returns to the page this was opened from, S2 or S2a (decisions #28).
import { ArrowUpRight, ChevronDown, SearchX, SlidersHorizontal } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { api } from "../api/client.js";
import FilterForm from "../components/FilterForm.jsx";
import Pagination from "../components/Pagination.jsx";
import {
  criteriaChips,
  describeCriteria,
  flatTypeLabel,
  formatArea,
  formatCount,
  formatLease,
  formatMonth,
  formatSGD,
  titleCase,
} from "../components/format.js";
import { backTarget } from "../components/navigation.js";
import { Alert, BackLink, Badge, Card, EmptyState, PageHeader, Skeleton } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

const loadOptions = (town, flatType) => api.filterOptions(town, flatType);

export default function HistoricalDataPageUI() {
  const { criteria, setCriteria } = useFilters();
  const location = useLocation();
  const back = backTarget(location, criteria);
  useDocumentTitle(criteria.town ? `Price history · ${describeCriteria(criteria)}` : "Price history");
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
  const chips = criteriaChips(criteria);

  return (
    <div className="container page">
      <BackLink to={back.to} label={back.label} />
      <PageHeader
        eyebrow="Historical data"
        title={describeCriteria(criteria)}
        subtitle={`Every matching resale transaction in ${titleCase(criteria.town)} since January 2017, newest first.`}
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

      {error && (
        <Alert
          kind="error"
          title="Couldn't load historical data"
          action={
            <button type="button" className="btn btn-sm" onClick={() => load_history(page?.page || 1)}>
              Try again
            </button>
          }
        >
          {error.message}
        </Alert>
      )}

      {page && page.total === 0 && (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="No matching records found"
            actions={
              <Link className="btn" to="/">
                Start a new search
              </Link>
            }
          >
            No resale transactions match these filters. Try removing a filter or choosing another town.
          </EmptyState>
        </div>
      )}

      {(!page || page.total > 0) && !error && (
        <Card
          title={page ? `${formatCount(page.total)} transactions` : "Loading transactions…"}
          description={page ? `Page ${page.page} of ${formatCount(page.total_pages)} · ${page.page_size} per page` : " "}
        >
          <div className="table-wrap" aria-busy={loading}>
            <table className="table">
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
                {!page &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }, (_, j) => (
                        <td key={j}>
                          <Skeleton />
                        </td>
                      ))}
                    </tr>
                  ))}
                {page?.records.map((record) => {
                  const detail = expanded[record.id];
                  return (
                    <Fragment key={record.id}>
                      <tr>
                        <td className="num">{formatMonth(record.transaction_month)}</td>
                        <td>
                          Blk {record.block} {titleCase(record.street_name)}
                        </td>
                        <td>{flatTypeLabel(record.flat_type)}</td>
                        <td className="num">{record.storey_range.toLowerCase()}</td>
                        <td className="number">{formatArea(record.floor_area_sqm)}</td>
                        <td>{formatLease(record.remaining_lease_years)}</td>
                        <td className="number strong">{formatSGD(record.resale_price_sgd)}</td>
                        <td>
                          <button
                            type="button"
                            className="expand-btn"
                            onClick={() => show_record_details(record.id)}
                            aria-expanded={Boolean(detail)}
                            aria-label={detail ? "Hide details" : "Show details"}
                          >
                            <ChevronDown size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                      {detail && (
                        <tr className="table-row-detail">
                          <td colSpan={8}>
                            {detail.loading && <Skeleton width="60%" />}
                            {detail.error && <span className="field-error">{detail.error}</span>}
                            {detail.record && (
                              <dl>
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
                                  <dt>Full record</dt>
                                  <dd>
                                    <Link to={`/results/${detail.record.id}`}>
                                      Open this transaction <ArrowUpRight size={13} style={{ display: "inline" }} />
                                    </Link>
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
          {page && page.total_pages > 1 && (
            <div className="card-footer">
              <Pagination page={page.page} totalPages={page.total_pages} onChange={change_page} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
