// Display helpers: prices in SGD, areas in sqm, months as "Oct 2026".

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatSGD(value, { signed = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const rounded = Math.round(Number(value));
  const text = `S$${Math.abs(rounded).toLocaleString("en-SG")}`;
  if (rounded < 0) return `−${text}`;
  return signed ? `+${text}` : text;
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
  return months ? `${whole} years ${months} month${months === 1 ? "" : "s"}` : `${whole} years`;
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

export function titleCase(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/(^|[\s/-])([a-z])/g, (_match, sep, letter) => sep + letter.toUpperCase());
}

/** "Hougang · 4 Room · 07 to 09 · Model A · ~93 sqm" */
export function describeCriteria(criteria = {}) {
  const parts = [titleCase(criteria.town)];
  if (criteria.flat_type) parts.push(titleCase(criteria.flat_type));
  if (criteria.storey_range) parts.push(`Storey ${criteria.storey_range.toLowerCase()}`);
  if (criteria.flat_model) parts.push(criteria.flat_model);
  if (criteria.floor_area_sqm !== "" && criteria.floor_area_sqm != null) parts.push(`about ${criteria.floor_area_sqm} sqm`);
  return parts.filter(Boolean).join(" · ");
}
