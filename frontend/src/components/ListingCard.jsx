// One resale transaction in the S2 list (UC-4.2: price, flat type, town, storey range, floor area,
// remaining lease and transaction period on every entry, SRS 4.2.3.2). The whole card opens S2a.
import { ArrowRight, Building2, CalendarDays, Hourglass, Layers, MapPin, Ruler } from "lucide-react";
import { Link } from "react-router-dom";
import { flatTypeLabel, formatArea, formatLease, formatMonth, formatSGD, titleCase } from "./format.js";
import { Badge } from "./ui.jsx";

export default function ListingCard({ record, onSelect }) {
  const perSqm = record.resale_price_sgd / record.floor_area_sqm;
  return (
    <li className="card listing">
      <Link
        to={`/results/${record.id}`}
        className="listing-link"
        onClick={(event) => {
          if (onSelect) {
            event.preventDefault();
            onSelect(record.id);
          }
        }}
        aria-label={`${formatSGD(record.resale_price_sgd)}, ${flatTypeLabel(record.flat_type)} at Blk ${record.block} ${titleCase(record.street_name)}, ${formatMonth(record.transaction_month)}. View details`}
      >
        <div className="listing-top">
          <div>
            <div className="listing-price">{formatSGD(record.resale_price_sgd)}</div>
            <div className="listing-psm">{formatSGD(perSqm)} per sqm</div>
          </div>
          <Badge icon={CalendarDays}>{formatMonth(record.transaction_month)}</Badge>
        </div>
        <div className="listing-address">
          <MapPin size={16} aria-hidden="true" />
          <span>
            Blk {record.block} {titleCase(record.street_name)}
          </span>
        </div>
        <div className="listing-sub">
          {titleCase(record.town)} · {record.flat_model}
        </div>
        <dl className="listing-facts">
          <div>
            <Building2 size={15} aria-hidden="true" />
            <dt>Flat type</dt>
            <dd>{flatTypeLabel(record.flat_type)}</dd>
          </div>
          <div>
            <Layers size={15} aria-hidden="true" />
            <dt>Storey</dt>
            <dd>Storey {record.storey_range.toLowerCase()}</dd>
          </div>
          <div>
            <Ruler size={15} aria-hidden="true" />
            <dt>Floor area</dt>
            <dd>{formatArea(record.floor_area_sqm)}</dd>
          </div>
          <div>
            <Hourglass size={15} aria-hidden="true" />
            <dt>Remaining lease</dt>
            <dd>{formatLease(record.remaining_lease_years)} left</dd>
          </div>
        </dl>
        <span className="listing-cta">
          View details <ArrowRight size={15} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
