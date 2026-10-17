// Prediction breakdown (UC-4.6): base price plus each feature's contribution in SGD, with a clear
// "raises" / "lowers" label and a bar, in plain language (no coefficients or statistical terms).
import { formatSGD, titleCase } from "./format.js";

// Show the entered values the way the rest of the app does ("Hougang", "4 Room", "07 to 09").
function displayValue(item) {
  if (item.feature_name === "Town" || item.feature_name === "Flat type") return titleCase(item.input_value);
  if (item.feature_name === "Storey range") return item.input_value.toLowerCase();
  return item.input_value;
}

export default function BreakdownTable({ basePrice, breakdown, estimate }) {
  const largest = Math.max(1, ...breakdown.map((item) => Math.abs(item.contribution_sgd)));
  return (
    <table className="table breakdown">
      <caption>How we got to this estimate</caption>
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">Your flat</th>
          <th scope="col" className="breakdown-bar-col">
            Effect
          </th>
          <th scope="col" className="number">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="breakdown-base">
          <th scope="row" colSpan={3}>
            Average price of flats sold recently
          </th>
          <td className="number">{formatSGD(basePrice)}</td>
        </tr>
        {breakdown.map((item) => {
          const raises = item.contribution_sgd >= 0;
          const width = `${(Math.abs(item.contribution_sgd) / largest) * 100}%`;
          return (
            <tr key={item.feature_name}>
              <th scope="row">{item.feature_name}</th>
              <td className="col-input">{displayValue(item)}</td>
              <td className="breakdown-bar-col">
                <span className={`breakdown-label ${raises ? "up" : "down"}`}>
                  {raises ? "Raises the price" : "Lowers the price"}
                </span>
                <span className="breakdown-track" aria-hidden="true">
                  <span className={`breakdown-bar ${raises ? "up" : "down"}`} style={{ width }} />
                </span>
              </td>
              <td className={`number ${raises ? "up" : "down"}`}>{formatSGD(item.contribution_sgd, { signed: true })}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>
            Estimated price
          </th>
          <td className="number">{formatSGD(estimate)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
