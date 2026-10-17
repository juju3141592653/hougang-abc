// Price trend graph for SummaryPageUI.render_chart() (UC-4.4). Every point is labelled with its
// month (axis ticks and tooltip), and the full month-by-month table is available underneath
// (SRS 4.4.3.3: "display the time period represented by every historical price value").
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMonth, formatSGD } from "./format.js";

function compactSGD(value) {
  if (Math.abs(value) >= 1_000_000) return `S$${(value / 1_000_000).toFixed(2)}M`;
  return `S$${Math.round(value / 1000)}k`;
}

export default function PriceTrendChart({ trend }) {
  const data = Object.entries(trend || {}).map(([month, median]) => ({ month, label: formatMonth(month), median }));
  if (!data.length) return null;
  return (
    <figure className="chart">
      <figcaption className="chart-title">Median resale price by month</figcaption>
      <div className="chart-body" role="img" aria-label={`Median resale price from ${data[0].label} to ${data.at(-1).label}`}>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />
            <YAxis tickFormatter={compactSGD} tick={{ fontSize: 12 }} width={72} domain={["auto", "auto"]} />
            <Tooltip
              formatter={(value) => [formatSGD(value), "Median price"]}
              labelFormatter={(label) => `Month: ${label}`}
            />
            <Line
              type="linear"
              dataKey="median"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={data.length <= 36 ? { r: 3 } : false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>Show the monthly figures ({data.length} months)</summary>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="number">
                Median price
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.month}>
                <td>{point.label}</td>
                <td className="number">{formatSGD(point.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
