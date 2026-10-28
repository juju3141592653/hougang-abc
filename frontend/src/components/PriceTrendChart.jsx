// Price trend for SummaryPageUI.render_chart() (UC-4.4). Two aligned charts on one time axis, never
// a dual-axis chart: the monthly median price, and below it the number of sales behind each median.
// Every point is labelled with its month (axis ticks and tooltip), and a month-by-month table is
// available underneath (SRS 4.4.3.3).
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactSGD, formatCount, formatMonth, formatSGD } from "./format.js";

const AXIS_TICK = { fontSize: 12, fill: "var(--viz-ink-muted)" };
const MONTH_STEPS = [1, 2, 3, 6, 12, 24];

/** Calendar-aligned month ticks (every month, quarter, half-year or January) shared by both charts. */
function monthTicks(data, maxTicks = 12) {
  const step = MONTH_STEPS.find((s) => data.length / s <= maxTicks) ?? 24;
  const ticks = data.filter((p) => (Number(p.month.slice(5, 7)) - 1) % step === 0).map((p) => p.label);
  const format = step >= 12 ? (label) => label.slice(-4) : (label) => label;
  return { ticks: ticks.length ? ticks : undefined, format };
}

/** Round, evenly spaced price ticks (S$300k, S$400k, ...) that cover every value. */
function priceTicks(values, target = 5) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const raw = (max - min || max * 0.1 || 1) / (target - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
  const ticks = [];
  for (let tick = Math.floor(min / step) * step; tick <= Math.ceil(max / step) * step; tick += step) {
    ticks.push(Math.round(tick));
  }
  return ticks;
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{point.label}</div>
      <div className="chart-tooltip-row">
        <span>
          <span className="swatch" style={{ background: "var(--viz-series)" }} />
          Median price
        </span>
        <strong>{formatSGD(point.median)}</strong>
      </div>
      <div className="chart-tooltip-row">
        <span>Sales</span>
        <strong>{formatCount(point.volume)}</strong>
      </div>
    </div>
  );
}

export default function PriceTrendChart({ trend, volume = {} }) {
  const data = Object.entries(trend || {}).map(([month, median]) => ({
    month,
    label: formatMonth(month),
    median,
    volume: volume[month] ?? null,
  }));
  if (!data.length) return null;
  const showDots = data.length <= 24;
  // Both charts share one band scale and one tick set, so each month lines up across them.
  const months = monthTicks(data);
  const xAxis = {
    dataKey: "label",
    scale: "band",
    ticks: months.ticks,
    tickFormatter: months.format,
    tick: AXIS_TICK,
    tickLine: false,
    axisLine: { stroke: "var(--viz-axis)" },
    minTickGap: 16,
  };
  const yTicks = priceTicks(data.map((p) => p.median));
  // Years of monthly bars get only a pixel or two each on a phone: square ends keep them visible.
  const denseBars = data.length > 36;
  return (
    <div>
      <div className="chart-title">
        <h3>Median resale price by month</h3>
        <span>
          {data[0].label} – {data.at(-1).label}
        </span>
      </div>
      <div
        className="chart-block"
        role="img"
        aria-label={`Median resale price by month from ${data[0].label} to ${data.at(-1).label}`}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} syncId="trend">
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-series)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--viz-series)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis {...xAxis} />
            <YAxis
              tickFormatter={formatCompactSGD}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={68}
              ticks={yTicks}
              domain={[yTicks[0], yTicks.at(-1)]}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }} />
            <Area type="linear" dataKey="median" stroke="none" fill="url(#trendFill)" isAnimationActive={false} />
            <Line
              type="linear"
              dataKey="median"
              stroke="var(--viz-series)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={showDots ? { r: 4, strokeWidth: 2, stroke: "#fff", fill: "var(--viz-series)" } : false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: "var(--viz-series)" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-title">
        <h3>Number of sales by month</h3>
        <span>The sales each monthly median is based on</span>
      </div>
      <div className="chart-block" role="img" aria-label="Number of resale transactions by month">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
            syncId="trend"
            barCategoryGap={denseBars ? "12%" : 2}
          >
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
            <XAxis {...xAxis} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={68} allowDecimals={false} />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(42, 120, 214, 0.06)" }} />
            <Bar
              dataKey="volume"
              fill="var(--viz-volume)"
              radius={denseBars ? 0 : [4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="data-table-toggle">
        <summary>Show the monthly figures ({data.length} months)</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="number">
                  Median price
                </th>
                <th scope="col" className="number">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((point) => (
                <tr key={point.month}>
                  <td>{point.label}</td>
                  <td className="number">{formatSGD(point.median)}</td>
                  <td className="number">{formatCount(point.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
