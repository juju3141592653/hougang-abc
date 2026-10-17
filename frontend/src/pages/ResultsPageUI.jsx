// <<boundary>> ResultsPageUI: dialog map S2 Latest Results Page.
// UC-4.2 View Latest Price (included by UC-4.1). Methods mirror the class diagram:
// show_latest(), select_record(id), show_town_map(). Attribute: page (TransactionPage).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import Message from "../components/Message.jsx";
import Pagination from "../components/Pagination.jsx";
import TownMap from "../components/TownMap.jsx";
import TransactionCard from "../components/TransactionCard.jsx";
import { describeCriteria, formatMonth } from "../components/format.js";
import { useFilters } from "../state/FilterContext.jsx";

export default function ResultsPageUI() {
  const { criteria } = useFilters();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [dataInfo, setDataInfo] = useState(null);
  const latestRequest = useRef(0);

  /** show_latest(): fetch a page of the most recent matching transactions (UC-4.2 steps 2-4, AC.2). */
  const show_latest = useCallback(
    async (pageNumber = 1) => {
      const request = ++latestRequest.current; // a slower earlier page must not overwrite a newer one
      setLoading(true);
      setError(null);
      try {
        const result = await api.latest(criteria, pageNumber);
        if (request === latestRequest.current) setPage(result);
      } catch (err) {
        if (request === latestRequest.current) setError(err);
      } finally {
        if (request === latestRequest.current) setLoading(false);
      }
    },
    [criteria],
  );

  useEffect(() => {
    if (criteria.town) show_latest(1);
  }, [criteria, show_latest]);

  useEffect(() => {
    api.lastUpdated().then(setDataInfo).catch(() => setDataInfo(null));
  }, []);

  /** select_record(id): open S2a Property Details (UC-4.2 AC.1). */
  const select_record = (id) => navigate(`/results/${id}`);

  /** show_town_map(): show or hide the map of the selected town. */
  const show_town_map = () => setMapVisible((visible) => !visible);

  if (!criteria.town) return <Navigate to="/" replace />;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Latest resale prices</p>
          <h1>{describeCriteria(criteria)}</h1>
          {dataInfo?.latest_month && (
            <p className="muted">Sales registered in the 12 months up to {formatMonth(dataInfo.latest_month)}.</p>
          )}
        </div>
        <div className="page-header-actions">
          <Link className="button" to="/">
            Change filters
          </Link>
          <button type="button" className="button" onClick={show_town_map} aria-expanded={mapVisible}>
            {mapVisible ? "Hide town map" : "Show town map"}
          </button>
        </div>
      </header>

      {mapVisible && <TownMap town={criteria.town} />}

      {error && (
        <Message
          kind="error"
          title="Couldn't load the latest prices"
          action={
            <button type="button" className="button" onClick={() => show_latest(page?.page || 1)}>
              Try again
            </button>
          }
        >
          {error.message}
        </Message>
      )}

      {loading && !page && <p className="muted">Loading the latest prices…</p>}

      {page && page.total === 0 && (
        <Message kind="info" title="No recent transactions found">
          No flats matching these filters were sold in the last 12 months. Try broadening your filters, or{" "}
          <Link to="/history">view historical data</Link> for older sales.
        </Message>
      )}

      {page && page.total > 0 && (
        <>
          <p className="result-count">
            {page.total.toLocaleString("en-SG")} sale{page.total === 1 ? "" : "s"} · newest first · select a flat for
            details, history, statistics and a price estimate
          </p>
          <ul className="card-grid" aria-busy={loading}>
            {page.records.map((record) => (
              <TransactionCard key={record.id} record={record} onSelect={select_record} />
            ))}
          </ul>
          <Pagination page={page.page} totalPages={page.total_pages} onChange={show_latest} />
        </>
      )}
    </div>
  );
}
