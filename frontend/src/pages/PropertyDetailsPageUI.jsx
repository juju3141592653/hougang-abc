// <<boundary>> PropertyDetailsPageUI: dialog map S2a Property Details Page.
// UC-4.2 AC.1 (full details of the selected transaction) and the entry point to UC-4.3, UC-4.4 and
// UC-4.5. Methods mirror the class diagram: load_record(id), open_history(), open_summary(),
// open_prediction(). Attributes: selected_record (Transaction), criteria (FilterCriteria).
// S3, S4 and S5 opened from here come "Back to property details" (decisions #28).
import {
  BarChart3,
  Building2,
  Calculator,
  CalendarDays,
  ChevronRight,
  Hourglass,
  KeyRound,
  Layers,
  MapPin,
  Ruler,
  Shapes,
  SearchX,
  Tag,
  History,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import {
  describeCriteria,
  flatTypeLabel,
  formatArea,
  formatLease,
  formatMonth,
  formatSGD,
  titleCase,
} from "../components/format.js";
import { originState } from "../components/navigation.js";
import { BackLink, Badge, Breadcrumbs, Card, EmptyState, Skeleton } from "../components/ui.jsx";
import useDocumentTitle from "../components/useDocumentTitle.js";
import { useFilters } from "../state/FilterContext.jsx";

export default function PropertyDetailsPageUI() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { criteria, setCriteria } = useFilters();
  const [selected_record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  useDocumentTitle(
    selected_record ? `Blk ${selected_record.block} ${titleCase(selected_record.street_name)}` : "Property details",
  );

  /** load_record(id): fetch the transaction (UC-4.2 AC.1). */
  const load_record = useCallback(async (recordId) => {
    setError(null);
    setRecord(null);
    try {
      setRecord(await api.transaction(recordId));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load_record(id);
  }, [id, load_record]);

  // "Keep selected housing criteria": if the page was opened directly, use the record's town and type.
  const searchCriteria = criteria.town
    ? criteria
    : selected_record
      ? { town: selected_record.town, flat_type: selected_record.flat_type }
      : criteria;
  const ensureCriteria = () => {
    if (!criteria.town && selected_record) setCriteria(searchCriteria);
  };

  /** open_history(): S3 Historical Data Page (UC-4.3). */
  const open_history = () => {
    ensureCriteria();
    navigate("/history", { state: originState(location) });
  };

  /** open_summary(): S4 Summary Statistics Page (UC-4.4). */
  const open_summary = () => {
    ensureCriteria();
    navigate("/summary", { state: originState(location) });
  };

  /** open_prediction(): S5 Prediction Input Page, pre-filled from this property (UC-4.5 step 2). */
  const open_prediction = () => {
    ensureCriteria();
    navigate("/predict", { state: originState(location, { record: selected_record }) });
  };

  const crumbs = [
    { label: "Search", to: "/" },
    { label: "Latest results", to: "/results" },
    { label: selected_record ? `Blk ${selected_record.block} ${titleCase(selected_record.street_name)}` : "Details" },
  ];

  if (error) {
    return (
      <div className="container page">
        <BackLink to="/results" label="Back to results" />
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="Couldn't load this transaction"
            actions={
              <Link className="btn btn-primary" to="/results">
                Back to results
              </Link>
            }
          >
            {error.message}
          </EmptyState>
        </div>
      </div>
    );
  }

  const r = selected_record;
  const facts = r
    ? [
        { icon: CalendarDays, label: "Month registered", value: formatMonth(r.transaction_month) },
        { icon: MapPin, label: "Town", value: titleCase(r.town) },
        { icon: Building2, label: "Flat type", value: flatTypeLabel(r.flat_type) },
        { icon: Shapes, label: "Flat model", value: r.flat_model },
        { icon: Layers, label: "Storey range", value: r.storey_range.toLowerCase() },
        { icon: Ruler, label: "Floor area", value: formatArea(r.floor_area_sqm) },
        { icon: KeyRound, label: "Lease commenced", value: String(r.lease_commence_date) },
        { icon: Hourglass, label: "Remaining lease at sale", value: formatLease(r.remaining_lease_years) },
      ]
    : [];

  return (
    <div className="container page">
      <div>
        <Breadcrumbs items={crumbs} />
        <BackLink to="/results" label="Back to results" />
      </div>

      <div className="card detail-hero">
        {r ? (
          <>
            <div className="page-header-text">
              <p className="eyebrow">Resale transaction</p>
              <h1>
                Blk {r.block} {titleCase(r.street_name)}
              </h1>
              <div className="chip-row">
                <Badge tone="primary" icon={Building2}>
                  {flatTypeLabel(r.flat_type)}
                </Badge>
                <Badge icon={MapPin}>{titleCase(r.town)}</Badge>
                <Badge icon={CalendarDays}>Registered {formatMonth(r.transaction_month)}</Badge>
              </div>
            </div>
            <div className="detail-price">
              <span className="subtle">Resale price (actual sale)</span>
              <span className="detail-price-value">{formatSGD(r.resale_price_sgd)}</span>
              <span className="subtle">
                <Tag size={13} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
                {formatSGD(r.resale_price_sgd / r.floor_area_sqm)} per sqm
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }} aria-busy="true">
            <Skeleton width="20%" />
            <Skeleton width="55%" height={30} />
            <Skeleton width="35%" />
          </div>
        )}
      </div>

      <div className="detail-layout">
        <Card title="Transaction details" description="As registered with HDB">
          {r ? (
            <dl className="facts-grid">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label}>
                  <span className="fact-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <div>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          ) : (
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} height={34} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Explore further" description={`Using your search: ${describeCriteria(searchCriteria) || "–"}`}>
          <div className="action-list">
            <button type="button" className="action-card" onClick={open_history} disabled={!r}>
              <span className="feature-icon" aria-hidden="true">
                <History size={18} />
              </span>
              <span className="action-card-text">
                <strong>View historical data</strong>
                <span>Every matching sale since January 2017</span>
              </span>
              <ChevronRight size={18} className="chevron" aria-hidden="true" />
            </button>
            <button type="button" className="action-card" onClick={open_summary} disabled={!r}>
              <span className="feature-icon" aria-hidden="true">
                <BarChart3 size={18} />
              </span>
              <span className="action-card-text">
                <strong>View summary</strong>
                <span>Median, average and the price trend</span>
              </span>
              <ChevronRight size={18} className="chevron" aria-hidden="true" />
            </button>
            <button type="button" className="action-card action-card-primary" onClick={open_prediction} disabled={!r}>
              <span className="feature-icon" aria-hidden="true">
                <Calculator size={18} />
              </span>
              <span className="action-card-text">
                <strong>View prediction</strong>
                <span>Estimate this flat's fair price today</span>
              </span>
              <ChevronRight size={18} className="chevron" aria-hidden="true" />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
