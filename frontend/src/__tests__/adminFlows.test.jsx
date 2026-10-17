// Key admin flows (UC-4.8, UC-4.9, UC-4.10 manual check, UC-4.11; dialog map S7-S10, S9a, E3, E4).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client.js";
import { apiError, fixtures, resetMockApi } from "./mockApi.js";
import { renderApp } from "./renderApp.jsx";

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { createMockApi } = await import("./mockApi.js");
  return { ...actual, api: createMockApi() };
});

const SESSION_KEY = "hougang.admin.session";

beforeEach(() => resetMockApi(api));

function loggedIn() {
  window.sessionStorage.setItem(SESSION_KEY, "session-from-test");
}

async function logIn(user, password = "correct") {
  await user.type(await screen.findByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("S7 Admin Authorization (UC-4.11)", () => {
  it("admin pages require a session: direct URL goes to the login page", async () => {
    renderApp("/admin/diagnostics");
    expect(await screen.findByRole("heading", { name: "Admin login" })).toBeInTheDocument();
    expect(api.admin.diagnostics).not.toHaveBeenCalled();
  });

  it("E3: wrong credentials keep the admin on the login page with a generic message", async () => {
    const user = userEvent.setup();
    api.admin.login.mockRejectedValueOnce(apiError(fixtures.loginFailed, 401));
    renderApp("/admin/login");
    await logIn(user, "wrong");
    expect(await screen.findByText("Login failed")).toBeInTheDocument();
    expect(screen.getByText("Invalid username or password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("successful login opens the S8 dashboard with the dataset status", async () => {
    const user = userEvent.setup();
    renderApp("/admin/login");
    await logIn(user);
    expect(api.admin.login).toHaveBeenCalledWith("admin", "correct");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect((await screen.findByText("Transactions stored")).nextElementSibling).toHaveTextContent(
      fixtures.adminStatus.total_rows.toLocaleString("en-SG"),
    );
    expect(api.admin.status).toHaveBeenCalledWith("session-from-test");
  });

  it("an expired session returns to S7, and logging in again goes back to the requested page", async () => {
    const user = userEvent.setup();
    loggedIn();
    api.admin.diagnostics.mockRejectedValueOnce(
      new ApiError(401, { code: "unauthorized", message: "Your admin session has expired. Please log in again." }),
    );
    renderApp("/admin/diagnostics");
    expect(await screen.findByText("Your admin session has expired. Please log in again.")).toBeInTheDocument();
    await logIn(user);
    expect(await screen.findByRole("heading", { name: "Model diagnostics" })).toBeInTheDocument();
  });

  it("logging out returns to the public search page (S1)", async () => {
    const user = userEvent.setup();
    loggedIn();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(api.admin.logout).toHaveBeenCalledWith("session-from-test");
    expect(await screen.findByRole("heading", { name: /really selling for/ })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("runs the data.gov.sg check from the dashboard (UC-4.10 on demand)", async () => {
    const user = userEvent.setup();
    loggedIn();
    renderApp("/admin");
    await user.click(await screen.findByRole("button", { name: /Check data.gov.sg now/ }));
    expect(api.admin.updateFromApi).toHaveBeenCalled();
    expect(await screen.findByText(/recent records checked, 0 new added/)).toBeInTheDocument();
  });
});

describe("S9 Dataset Management (UC-4.9)", () => {
  async function chooseFile(user, name = "resale.csv") {
    const input = await screen.findByLabelText(/Dataset file/);
    await user.upload(input, new File(["month,town\n"], name, { type: "text/csv" }));
  }

  it("E4: a rejected upload lists the missing columns", async () => {
    const user = userEvent.setup();
    loggedIn();
    api.admin.uploadDataset.mockRejectedValueOnce(apiError(fixtures.uploadRejected, 400));
    renderApp("/admin/dataset");
    await chooseFile(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Upload rejected")).toBeInTheDocument();
    expect(screen.getByText(fixtures.uploadRejected.error.details.missing_columns.join(", "))).toBeInTheDocument();
  });

  it("rejects a wrong file type before uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    loggedIn();
    renderApp("/admin/dataset");
    await chooseFile(user, "notes.txt");
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText(/Upload a .csv or .xlsx file/)).toBeInTheDocument();
    expect(api.admin.uploadDataset).not.toHaveBeenCalled();
  });

  it("S9a: an accepted upload shows the import summary, then 'Upload another file' returns to S9", async () => {
    const user = userEvent.setup();
    loggedIn();
    renderApp("/admin/dataset");
    await chooseFile(user);
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(api.admin.uploadDataset).toHaveBeenCalledWith("session-from-test", expect.any(File));
    expect(screen.getByText("Rows in file").nextElementSibling).toHaveTextContent(
      fixtures.uploadSummary.rows_received.toLocaleString("en-SG"),
    );
    await user.click(screen.getByRole("button", { name: "Upload another file" }));
    expect(screen.getByLabelText(/Dataset file/)).toBeInTheDocument();
  });
});

describe("S10 Model Diagnostics (UC-4.8)", () => {
  it("shows R², adjusted R², RMSE and the coefficient table", async () => {
    loggedIn();
    renderApp("/admin/diagnostics");
    expect(await screen.findByText(fixtures.diagnostics.r_squared.toFixed(4))).toBeInTheDocument();
    expect(screen.getByText(fixtures.diagnostics.adjusted_r_squared.toFixed(4))).toBeInTheDocument();
    const names = Object.keys(fixtures.diagnostics.coefficients);
    expect(screen.getByText(names[1])).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(names.length + 1);
  });

  it("an unavailable model shows a message and Retry (EX.1)", async () => {
    const user = userEvent.setup();
    loggedIn();
    api.admin.diagnostics.mockRejectedValueOnce(
      new ApiError(503, { code: "model_unavailable", message: "No trained model is available yet." }),
    );
    renderApp("/admin/diagnostics");
    expect(await screen.findByText("Model unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(fixtures.diagnostics.r_squared.toFixed(4))).toBeInTheDocument());
  });
});
