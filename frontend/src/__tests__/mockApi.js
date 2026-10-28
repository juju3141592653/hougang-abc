// Mocked API for page tests. Default answers are real responses recorded from the backend
// (fixtures/api.json, see backend/scripts/make_frontend_fixtures.py).
import { vi } from "vitest";
import { ApiError } from "../api/client.js";
import fixtures from "./fixtures/api.json";

export { fixtures };

export const apiError = (recorded, status) => new ApiError(status, recorded.error);

const defaults = {
  filterOptions: (town, flatType) =>
    town && flatType ? fixtures.filterOptionsTownType : town ? fixtures.filterOptionsTown : fixtures.filterOptionsAll,
  latest: () => fixtures.latest,
  history: () => fixtures.history,
  transaction: () => fixtures.transaction,
  summary: (_criteria, period) => (period === "1y" ? fixtures.summary1y : fixtures.summaryAll),
  predict: () => fixtures.prediction,
  lastUpdated: () => fixtures.lastUpdated,
};
const adminDefaults = {
  login: () => ({ session_id: "session-from-test", idle_timeout_minutes: 30 }),
  logout: () => ({ logged_out: true }),
  status: () => fixtures.adminStatus,
  checkDataset: () => fixtures.datasetCheck,
  uploadDataset: () => fixtures.uploadSummary,
  updateFromApi: () => ({ source: "api", status: "success", rows_received: 0, rows_added: 0, rows_rejected: 0 }),
  diagnostics: () => fixtures.diagnostics,
};

export function createMockApi() {
  const api = { admin: {} };
  Object.keys(defaults).forEach((name) => (api[name] = vi.fn()));
  Object.keys(adminDefaults).forEach((name) => (api.admin[name] = vi.fn()));
  resetMockApi(api);
  return api;
}

export function resetMockApi(api) {
  Object.entries(defaults).forEach(([name, impl]) => {
    api[name].mockReset();
    api[name].mockImplementation(async (...args) => structuredClone(impl(...args)));
  });
  Object.entries(adminDefaults).forEach(([name, impl]) => {
    api.admin[name].mockReset();
    api.admin[name].mockImplementation(async (...args) => structuredClone(impl(...args)));
  });
}
