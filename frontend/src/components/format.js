// Display helpers: prices in SGD, areas in sqm, months as "Oct 2026", flat types as "4-room".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatSGD(value, { signed = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const rounded = Math.round(Number(value));
  const text = `S$${Math.abs(rounded).toLocaleString("en-SG")}`;
  if (rounded < 0) return `−${text}`;
  return signed ? `+${text}` : text;
}

/** S$1.24M / S$685k: for axis ticks and tight spaces. */
export function formatCompactSGD(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 1_000_000) return `S$${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (Math.abs(v) >= 1_000) return `S$${Math.round(v / 1_000)}k`;
  return `S$${Math.round(v)}`;
}

export function formatPercent(value, { signed = true } = {}) {
  if (!Number.isFinite(value)) return "–";
  const text = `${Math.abs(value).toFixed(1)}%`;
  if (value < 0) return `−${text}`;
  return signed ? `+${text}` : text;
}

export function formatCount(value) {
  return value === null || value === undefined ? "–" : Number(value).toLocaleString("en-SG");
}

export function formatMonth(month) {
  if (!month) return "–";
  const [year, mon] = String(month).split("-");
  const name = MONTHS[Number(mon) - 1];
  return name ? `${name} ${year}` : String(month);
}

export function formatLease(years) {
  if (years === null || years === undefined) return "–";
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (months === 12) return `${whole + 1} years`;
  return months ? `${whole} yrs ${months} mth${months === 1 ? "" : "s"}` : `${whole} years`;
}

export function formatArea(sqm) {
  return sqm === null || sqm === undefined ? "–" : `${Number(sqm).toLocaleString("en-SG")} sqm`;
}

export function formatDateTime(iso) {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(iso) {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString("en-SG", { dateStyle: "medium" });
}

export function formatTime(iso) {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleTimeString("en-SG", { timeStyle: "short" });
}

export function titleCase(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(^|[\s/-])([a-z])/g, (_match, sep, letter) => sep + letter.toUpperCase());
}

/** "4 ROOM" -> "4-room", "EXECUTIVE" -> "Executive", "MULTI-GENERATION" -> "Multi-generation". */
export function flatTypeLabel(flatType) {
  if (!flatType) return "";
  const match = /^(\d) ROOM$/.exec(flatType);
  if (match) return `${match[1]}-room`;
  const lower = flatType.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function storeyLabel(storeyRange) {
  return storeyRange ? `Storey ${storeyRange.toLowerCase()}` : "";
}

/** Short headline for a set of filters: "Hougang · 4-room". */
export function describeCriteria(criteria = {}) {
  const parts = [titleCase(criteria.town)];
  if (criteria.flat_type) parts.push(flatTypeLabel(criteria.flat_type));
  return parts.filter(Boolean).join(" · ");
}

/** The optional filters as chip labels. */
export function criteriaChips(criteria = {}) {
  const chips = [];
  if (criteria.storey_range) chips.push(storeyLabel(criteria.storey_range));
  if (criteria.flat_model) chips.push(criteria.flat_model);
  if (criteria.floor_area_sqm !== "" && criteria.floor_area_sqm != null) chips.push(`≈ ${criteria.floor_area_sqm} sqm`);
  return chips;
}
