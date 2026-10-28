// <<boundary>> ResultsPageUI: dialog map S2 Latest Results Page.
// UC-4.2 View Latest Price (included by UC-4.1). Methods mirror the class diagram:
// show_latest(), select_record(id), show_town_map(). Attribute: page (TransactionPage).
// From here the user can also open S3 / S4 / S5 for the whole search (decisions #28); those pages
// then come "Back to results".
import { BarChart3, Calculator, History, Map as MapIcon, MapPinOff, SearchX, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import ListingCard from "../components/ListingCard.jsx";
import Pagination from "../components/Pagination.jsx";
import TownMap from "../components/TownMap.jsx";
import { criteriaChips, describeCriteria, formatCount, formatMonth, formatSGD } from "../components/format.js";
import { originState } from "../components/navigation.js";
import { Alert, Badge, Breadcrumbs, EmptyState, PageHeader, Skeleton } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

function ListingSkeleton() {
  return (
    <li className="card listing" aria-hidden="true">
      <div className="listing-link">
        <Skeleton width="45%" height={24} />
        <Skeleton width="70%" />
        <Skeleton width="100%" height={56} />
      </div>
    </li>
  );
}

export default function ResultsPageUI() {
  const { criteria } = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  useDocumentTitle(criteria.town ? `Latest prices · ${describeCriteria(criteria)}` : "Latest prices");
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [stats, setStats] = useState(null);
  const [latestMonth, setLatestMonth] = useState(null);
  const latestRequest = useRef(0);
  const listTop = useRef(null);

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
    if (!criteria.town) return;
    show_latest(1);
    setStats(null);
    api.summary(criteria, "1y").then(setStats).catch(() => setStats(null));
  }, [criteria, show_latest]);

  useEffect(() => {
    api.lastUpdated().then((info) => setLatestMonth(info.latest_month)).catch(() => setLatestMonth(null));
  }, []);

  /** select_record(id): open S2a Property Details (UC-4.2 AC.1). */
  const select_record = (id) => navigate(`/results/${id}`);

  /** show_town_map(): show or hide the map of the selected town. */
  const show_town_map = () => setMapVisible((visible) => !visible);

  const goTo = (path) => navigate(path, { state: originState(location) });

  const changePage = (pageNumber) => {
    show_latest(pageNumber);
    listTop.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  if (!criteria.town) return <Navigate to="/" replace />;
  const chips = criteriaChips(criteria);

  return (
    <div className="container page">
      <div>
        <Breadcrumbs items={[{ label: "Search", to: "/" }, { label: "Latest results" }]} />
        <PageHeader
          eyebrow="Latest resale prices"
          title={describeCriteria(criteria)}
          subtitle={
            latestMonth
              ? `Flats registered in the 12 months up to ${formatMonth(latestMonth)}, newest first.`
              : "Flats registered in the last 12 months, newest first."
          }
          actions={
            <>
              <Link className="btn" to="/">
                <SlidersHorizontal size={16} aria-hidden="true" />
                Change filters
              </Link>
              <button type="button" className="btn" onClick={show_town_map} aria-expanded={mapVisible}>
                {mapVisible ? <MapPinOff size={16} aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
                {mapVisible ? "Hide town map" : "Show town map"}
              </button>
            </>
          }
        >
          {chips.length > 0 && (
            <div className="chip-row">
              {chips.map((chip) => (
                <Badge key={chip}>{chip}</Badge>
              ))}
            </div>
          )}
        </PageHeader>
      </div>

      {stats && stats.count > 0 && (
        <div className="card stats-strip" aria-label="Last 12 months at a glance">
          <div>
            <span className="stat-label">Sales in the last 12 months</span>
            <span className="stat-value">{formatCount(stats.count)}</span>
          </div>
          <div>
            <span className="stat-label">Median price</span>
            <span className="stat-value">{formatSGD(stats.median_sgd)}</span>
          </div>
          <div>
            <span className="stat-label">Average price</span>
            <span className="stat-value">{formatSGD(stats.mean_sgd)}</span>
          </div>
          <div>
            <span className="stat-label">Median per sqm</span>
            <span className="stat-value">{formatSGD(stats.median_psm_sgd)}</span>
          </div>
        </div>
      )}

      <div className="card explore-bar">
        <div className="explore-bar-text">
          <strong>Go deeper on this search</strong>
          <span>History, market trends and a price estimate for {describeCriteria(criteria)} flats.</span>
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn" onClick={() => goTo("/history")}>
            <History size={16} aria-hidden="true" />
            Price history
          </button>
          <button type="button" className="btn" onClick={() => goTo("/summary")}>
            <BarChart3 size={16} aria-hidden="true" />
            Market summary
          </button>
          <button type="button" className="btn btn-primary" onClick={() => goTo("/predict")}>
            <Calculator size={16} aria-hidden="true" />
            Estimate a price
          </button>
        </div>
      </div>

      {mapVisible && <TownMap town={criteria.town} />}

      {error && (
        <Alert
          kind="error"
          title="Couldn't load the latest prices"
          action={
            <button type="button" className="btn btn-sm" onClick={() => show_latest(page?.page || 1)}>
              Try again
            </button>
          }
        >
          {error.message}
        </Alert>
      )}

      <div ref={listTop} />
      {loading && !page && (
        <ul className="result-grid" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 6 }, (_, index) => (
            <ListingSkeleton key={index} />
          ))}
        </ul>
      )}

      {page && page.total === 0 && (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="No recent transactions found"
            actions={
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo("/history")}>
                  <History size={16} aria-hidden="true" />
                  View historical data
                </button>
                <Link className="btn" to="/">
                  Broaden your filters
                </Link>
              </>
            }
          >
            No flats matching these filters were registered in the last 12 months. Older sales may still exist.
          </EmptyState>
        </div>
      )}

      {page && page.total > 0 && (
        <>
          <div className="results-meta">
            <span>
              <strong className="num">{formatCount(page.total)}</strong> sale{page.total === 1 ? "" : "s"} · newest
              first · page {page.page} of {formatCount(page.total_pages)}
            </span>
            <span className="subtle">Select a sale for full details, history, market trends and an estimate.</span>
          </div>
          <ul className="result-grid" aria-busy={loading}>
            {page.records.map((record) => (
              <ListingCard key={record.id} record={record} onSelect={select_record} />
            ))}
          </ul>
          <Pagination page={page.page} totalPages={page.total_pages} onChange={changePage} />
        </>
      )}
    </div>
  );
}
