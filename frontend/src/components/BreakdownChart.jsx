// Prediction breakdown (UC-4.6), drawn as a diverging bar chart inside a real table: each feature's
// contribution in SGD to the right (raises the price) or left (lowers it) of a zero axis, with the
// signed amount and a "raises"/"lowers" word, so the direction never relies on colour alone.
// Starts from the average recent price and ends at the estimate: base + contributions = estimate.
import { flatTypeLabel, formatSGD, titleCase } from "./format.js";

function displayValue(item) {
  if (item.feature_name === "Town") return titleCase(item.input_value);
  if (item.feature_name === "Flat type") return flatTypeLabel(item.input_value);
  if (item.feature_name === "Storey range") return item.input_value.toLowerCase();
  return item.input_value;
}

export default function BreakdownChart({ basePrice, breakdown, estimate }) {
  const largest = Math.max(1, ...breakdown.map((item) => Math.abs(item.contribution_sgd)));
  return (
    <table className="breakdown">
      <caption className="visually-hidden">How each feature moves the estimate from the average recent price</caption>
      <thead>
        <tr>
          <th scope="col" className="bd-feature">
            Feature
          </th>
          <th scope="col" className="bd-chart">
            <span className="visually-hidden">Effect</span>
          </th>
          <th scope="col" className="bd-amount">
            Effect on price
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="bd-base">
          <th scope="row" className="bd-feature" colSpan={2}>
            Average price of flats sold in the last 24 months
          </th>
          <td className="bd-amount">{formatSGD(basePrice)}</td>
        </tr>
        {breakdown.map((item) => {
          const raises = item.contribution_sgd >= 0;
          const width = `${(Math.abs(item.contribution_sgd) / largest) * 50}%`;
          const amount = formatSGD(item.contribution_sgd, { signed: true });
          return (
            <tr key={item.feature_name} title={`${item.feature_name}: ${amount}`}>
              <th scope="row" className="bd-feature">
                <strong>{item.feature_name}</strong>
                <span>{displayValue(item)}</span>
              </th>
              <td className="bd-chart" aria-hidden="true">
                <div className="bd-track">
                  <span className="bd-axis" />
                  <span className={`bd-bar ${raises ? "up" : "down"}`} style={{ width }} />
                </div>
              </td>
              <td className="bd-amount">
                {amount}
                <small>{raises ? "raises the price" : "lowers the price"}</small>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="bd-total">
          <th scope="row" colSpan={2}>
            Estimated price
          </th>
          <td className="bd-amount">{formatSGD(estimate)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
