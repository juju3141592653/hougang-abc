// One resale transaction as a listing card (UC-4.2: price, flat type, town, storey range, floor area,
// remaining lease and transaction period on every entry, SRS 4.2.3.2).
import { formatArea, formatLease, formatMonth, formatSGD, titleCase } from "./format.js";

export default function TransactionCard({ record, onSelect }) {
  return (
    <li className="card transaction-card">
      <button type="button" className="card-button" onClick={() => onSelect(record.id)}>
        <div className="transaction-card-top">
          <span className="price">{formatSGD(record.resale_price_sgd)}</span>
          <span className="pill">{formatMonth(record.transaction_month)}</span>
        </div>
        <p className="transaction-card-title">
          {titleCase(record.flat_type)} · Blk {record.block} {titleCase(record.street_name)}
        </p>
        <dl className="facts">
          <div>
            <dt>Town</dt>
            <dd>{titleCase(record.town)}</dd>
          </div>
          <div>
            <dt>Storey</dt>
            <dd>{record.storey_range.toLowerCase()}</dd>
          </div>
          <div>
            <dt>Floor area</dt>
            <dd>{formatArea(record.floor_area_sqm)}</dd>
          </div>
          <div>
            <dt>Remaining lease</dt>
            <dd>{formatLease(record.remaining_lease_years)}</dd>
          </div>
          <div>
            <dt>Flat model</dt>
            <dd>{record.flat_model}</dd>
          </div>
        </dl>
        <span className="card-link">View details →</span>
      </button>
    </li>
  );
}
