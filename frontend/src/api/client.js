// HTTP/JSON client for the Flask routes. React boundaries reach the Python controls only through
// these calls (architecture: "UI-to-manager dependencies cross the HTTP API").

export class ApiError extends Error {
  constructor(status, error = {}) {
    super(error.message || `Request failed (${status})`);
    this.status = status;
    this.code = error.code || "error";
    this.fields = error.fields || {};
    this.details = error.details || {};
  }
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function request(path, { method = "GET", query, json, formData, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`/api${path}${queryString(query)}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : formData,
    });
  } catch {
    throw new ApiError(0, {
      code: "network_error",
      message: "Cannot reach the Hougang ABC server. Check your connection and try again.",
    });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new ApiError(response.status, body?.error);
  return body;
}

/** FilterCriteria -> query parameters (only the fields that are set). */
export function criteriaParams(criteria = {}) {
  const { town, flat_type, storey_range, floor_area_sqm, flat_model } = criteria;
  return { town, flat_type, storey_range, floor_area_sqm, flat_model };
}

export const api = {
  // Public API (UC-4.1 to UC-4.6, UC-4.10 "last updated")
  filterOptions: (town = "") => request("/filter-options", { query: { town } }),
  latest: (criteria, page = 1) => request("/transactions/latest", { query: { ...criteriaParams(criteria), page } }),
  history: (criteria, page = 1) => request("/transactions/history", { query: { ...criteriaParams(criteria), page } }),
  transaction: (id) => request(`/transactions/${id}`),
  summary: (criteria, period) => request("/summary", { query: { ...criteriaParams(criteria), period } }),
  predict: (inputs) => request("/predict", { method: "POST", json: inputs }),
  lastUpdated: () => request("/last-updated"),

  // Admin API (UC-4.8 to UC-4.11); every call except login carries the session id.
  admin: {
    login: (username, password) => request("/admin/login", { method: "POST", json: { username, password } }),
    logout: (token) => request("/admin/logout", { method: "POST", token }),
    status: (token) => request("/admin/status", { token }),
    uploadDataset: (token, file) => {
      const formData = new FormData();
      formData.append("file", file);
      return request("/admin/dataset", { method: "POST", formData, token });
    },
    updateFromApi: (token) => request("/admin/update-from-api", { method: "POST", token }),
    diagnostics: (token) => request("/admin/diagnostics", { token }),
  },
};
