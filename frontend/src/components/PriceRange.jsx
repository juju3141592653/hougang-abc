// Likely price range for an estimate (SRS 3.1 "±RMSE", decisions #29): the estimate plus or minus the
// model's typical error for flats at this price level.
import { formatSGD } from "./format.js";

export default function PriceRange({ estimate, typicalError }) {
  if (!typicalError) return null;
  const low = Math.max(0, estimate - typicalError);
  const high = estimate + typicalError;
  return (
    <div className="range">
      <div className="range-labels">
        <span>
          Likely range <strong>{formatSGD(low)}</strong> – <strong>{formatSGD(high)}</strong>
        </span>
        <span>± {formatSGD(typicalError)}</span>
      </div>
      <div className="range-track" aria-hidden="true">
        <span className="range-fill" />
        <span className="range-marker" />
      </div>
      <p className="range-note">
        About two in three recent sales at this price level were within this range of the model's estimate.
      </p>
    </div>
  );
}
