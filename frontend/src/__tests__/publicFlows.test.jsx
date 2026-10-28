// Key end-user flows across the public pages (UC-4.1 to UC-4.7; dialog map S1-S6, S2a, E1, E2),
// including where "Back" leads from S3 / S4 / S5 / S6 (decisions #28).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { formatSGD } from "../components/format.js";
import { apiError, fixtures, resetMockApi } from "./mockApi.js";
import { renderApp } from "./renderApp.jsx";

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { createMockApi } = await import("./mockApi.js");
  return { ...actual, api: createMockApi() };
});

const criteria = fixtures.criteria; // { town: "TAMPINES", flat_type: "4 ROOM" }
const record = fixtures.transaction;
const detailsPath = `/results/${record.id}`;

beforeEach(() => resetMockApi(api));

async function chooseTown(user, town = "Tampines") {
  const townSelect = await screen.findByLabelText(/^Town/);
  await screen.findByRole("option", { name: town });
  await user.selectOptions(townSelect, town);
  return townSelect;
}

async function openDetails(user) {
  renderApp(detailsPath, { criteria });
  await screen.findByText("Transaction details");
  return user;
}

describe("S1 Search Filter Page (UC-4.1)", () => {
  it("loads towns, then the flat types for the town, then options for the town and flat type", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const flatType = screen.getByLabelText("Flat type");
    expect(flatType).toBeDisabled();
    await chooseTown(user);
    expect(api.filterOptions).toHaveBeenCalledWith("TAMPINES", "");
    await waitFor(() => expect(flatType).toBeEnabled());
    await user.selectOptions(flatType, "4 ROOM");
    // SRS 4.1: options update based on the user's prior selections (town AND flat type).
    await waitFor(() => expect(api.filterOptions).toHaveBeenCalledWith("TAMPINES", "4 ROOM"));
    const storeys = within(screen.getByLabelText("Storey range")).getAllByRole("option");
    expect(storeys).toHaveLength(fixtures.filterOptionsTownType.storey_ranges.length + 1);
  });

  it("resets the dependent filters when the town changes (AC.1)", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const townSelect = await chooseTown(user);
    const flatType = screen.getByLabelText("Flat type");
    await waitFor(() => expect(flatType).toBeEnabled());
    await user.selectOptions(flatType, "4 ROOM");
    const otherTown = fixtures.filterOptionsAll.towns.find((t) => t !== "TAMPINES");
    await user.selectOptions(townSelect, otherTown);
    expect(screen.getByLabelText("Flat type")).toHaveValue("");
  });

  it("E1: shows a field-specific error on S1 and keeps the inputs (UC-4.7 EX.1)", async () => {
    const user = userEvent.setup();
    api.latest.mockRejectedValueOnce(apiError(fixtures.filterValidationError, 400));
    renderApp("/");
    await chooseTown(user);
    await user.type(screen.getByLabelText("Floor area"), "huge");
    await user.click(screen.getByRole("button", { name: "Show latest prices" }));
    expect(await screen.findByText(fixtures.filterValidationError.error.fields.floor_area_sqm)).toBeInTheDocument();
    expect(screen.getByLabelText("Floor area")).toHaveValue("huge");
    expect(screen.getByLabelText(/^Town/)).toHaveValue("TAMPINES");
    expect(screen.getByRole("heading", { name: /really worth/ })).toBeInTheDocument();
  });

  it("valid filters lead to S2 with the latest transactions (UC-4.2)", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await chooseTown(user);
    await user.click(screen.getByRole("button", { name: "Show latest prices" }));
    expect(await screen.findByRole("heading", { name: "Tampines" })).toBeInTheDocument();
    const cards = await screen.findAllByRole("link", { name: /View details/ });
    expect(cards).toHaveLength(fixtures.latest.records.length);
  });
});

describe("S2 Latest Results Page (UC-4.2)", () => {
  it("redirects to S1 when no town has been chosen", async () => {
    renderApp("/results");
    expect(await screen.findByRole("heading", { name: /really worth/ })).toBeInTheDocument();
  });

  it("summarises the last 12 months and pages through results", async () => {
    const user = userEvent.setup();
    renderApp("/results", { criteria });
    expect(await screen.findByText("Sales in the last 12 months")).toBeInTheDocument();
    expect(screen.getByText(formatSGD(fixtures.summary1y.median_sgd))).toBeInTheDocument();
    await screen.findAllByRole("link", { name: /View details/ });
    await user.click(screen.getByRole("button", { name: "Page 2" }));
    expect(api.latest).toHaveBeenLastCalledWith(expect.objectContaining({ town: "TAMPINES" }), 2);
  });

  it("no recent records: suggests historical data, which comes back to results (EX.1)", async () => {
    const user = userEvent.setup();
    api.latest.mockResolvedValue(structuredClone(fixtures.latestEmpty));
    renderApp("/results", { criteria });
    expect(await screen.findByText("No recent transactions found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View historical data" }));
    expect(await screen.findByText("Historical data")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to results" })).toBeInTheDocument();
  });

  it("shows the town map on request", async () => {
    const user = userEvent.setup();
    renderApp("/results", { criteria });
    await user.click(await screen.findByRole("button", { name: "Show town map" }));
    expect(screen.getByTitle("Map of Tampines")).toBeInTheDocument();
  });

  it("opens S3, S4 and S5 for the whole search, each coming 'Back to results'", async () => {
    const user = userEvent.setup();
    renderApp("/results", { criteria });
    for (const [button, heading] of [
      ["Price history", "Historical data"],
      ["Market summary", "Market summary"],
      ["Estimate a price", "Fair price estimate"],
    ]) {
      await user.click(await screen.findByRole("button", { name: button }));
      expect(await screen.findByText(heading)).toBeInTheDocument();
      await user.click(screen.getAllByRole("link", { name: "Back to results" })[0]);
      await screen.findByText("Sales in the last 12 months");
    }
  });

  it("selecting a record opens S2a with its details and actions", async () => {
    const user = userEvent.setup();
    renderApp("/results", { criteria });
    const [first] = await screen.findAllByRole("link", { name: /View details/ });
    await user.click(first);
    expect(api.transaction).toHaveBeenCalledWith(String(fixtures.latest.records[0].id));
    expect(await screen.findByText("Transaction details")).toBeInTheDocument();
    for (const name of [/View historical data/, /View summary/, /View prediction/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("Back from S3 / S4 / S5 returns to the property (S2a)", () => {
  it("S2a -> S3 -> 'Back to property details' -> the same S2a", async () => {
    const user = await openDetails(userEvent.setup());
    await user.click(screen.getByRole("button", { name: /View historical data/ }));
    await user.click(await screen.findByRole("link", { name: "Back to property details" }));
    expect(await screen.findByText("Transaction details")).toBeInTheDocument();
    expect(api.transaction).toHaveBeenLastCalledWith(String(record.id));
  });

  it("S2a -> S4 -> 'Back to property details'", async () => {
    const user = await openDetails(userEvent.setup());
    await user.click(screen.getByRole("button", { name: /View summary/ }));
    await user.click(await screen.findByRole("link", { name: "Back to property details" }));
    expect(await screen.findByText("Transaction details")).toBeInTheDocument();
  });

  it("S2a -> S5 -> S6 -> 'Back to property details'", async () => {
    const user = await openDetails(userEvent.setup());
    await user.click(screen.getByRole("button", { name: /View prediction/ }));
    await user.click(await screen.findByRole("button", { name: "Predict price" }));
    await screen.findByText("Estimated current fair price");
    const backLinks = screen.getAllByRole("link", { name: "Back to property details" });
    expect(backLinks.length).toBe(2); // top of the page and the S6 actions
    await user.click(backLinks[1]);
    expect(await screen.findByText("Transaction details")).toBeInTheDocument();
  });
});

describe("S5 / S6 prediction (UC-4.5, UC-4.6, UC-4.7)", () => {
  async function openPrediction(user) {
    await openDetails(user);
    await user.click(screen.getByRole("button", { name: /View prediction/ }));
    await screen.findByText("Confirm the property's features");
  }

  it("pre-fills S5 from the selected property and shows the price, range and breakdown automatically", async () => {
    const user = userEvent.setup();
    await openPrediction(user);
    expect(screen.getByLabelText("Town")).toHaveValue(record.town);
    expect(screen.getByLabelText("Storey range")).toHaveValue(record.storey_range);
    expect(screen.getByLabelText("Floor area")).toHaveValue(String(record.floor_area_sqm));
    expect(screen.getByText(/Pre-filled from Blk/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Predict price" }));

    expect(api.predict).toHaveBeenCalledWith(expect.objectContaining({ town: record.town, flat_model: record.flat_model }));
    const prediction = fixtures.prediction;
    expect(await screen.findByText(formatSGD(prediction.estimated_price_sgd), { selector: ".price-hero" })).toBeInTheDocument();
    // Likely range = estimate ± typical error (SRS 3.1).
    const low = formatSGD(prediction.estimated_price_sgd - prediction.typical_error_sgd);
    const high = formatSGD(prediction.estimated_price_sgd + prediction.typical_error_sgd);
    expect(screen.getByText(low)).toBeInTheDocument();
    expect(screen.getByText(high)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /How each feature moves the estimate/ });
    for (const item of prediction.breakdown) {
      expect(within(table).getByText(item.feature_name)).toBeInTheDocument();
      expect(within(table).getByText(formatSGD(item.contribution_sgd, { signed: true }))).toBeInTheDocument();
    }
    expect(within(table).getByText(formatSGD(prediction.base_price_sgd))).toBeInTheDocument();
    expect(screen.getByText(/not an\s+official valuation/)).toBeInTheDocument();
    expect(screen.queryByText("Less reliable estimate")).not.toBeInTheDocument();
  });

  it("warns when the combination was not represented in the training data (AC.2)", async () => {
    const user = userEvent.setup();
    api.predict.mockResolvedValueOnce(structuredClone(fixtures.predictionUnseen));
    await openPrediction(user);
    await user.click(screen.getByRole("button", { name: "Predict price" }));
    expect(await screen.findByText("Less reliable estimate")).toBeInTheDocument();
    expect(
      screen.getByText(formatSGD(fixtures.predictionUnseen.estimated_price_sgd), { selector: ".price-hero" }),
    ).toBeInTheDocument();
  });

  it("shows the price with a clear message when the breakdown fails (UC-4.6 EX.1)", async () => {
    const user = userEvent.setup();
    const recorded = fixtures.prediction;
    api.predict.mockResolvedValueOnce({ ...recorded, breakdown_available: false, breakdown: [] });
    await openPrediction(user);
    await user.click(screen.getByRole("button", { name: "Predict price" }));
    expect(await screen.findByText("Breakdown temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText(formatSGD(recorded.estimated_price_sgd), { selector: ".price-hero" })).toBeInTheDocument();
  });

  it("E2: insufficient data shows a warning on S5 and keeps the inputs (UC-4.7 EX.3)", async () => {
    const user = userEvent.setup();
    api.predict.mockRejectedValueOnce(apiError(fixtures.predictionInsufficient, 422));
    await openPrediction(user);
    await user.click(screen.getByRole("button", { name: "Predict price" }));
    expect(await screen.findByText("Not enough data for a reliable estimate")).toBeInTheDocument();
    expect(screen.getByText(fixtures.predictionInsufficient.error.message)).toBeInTheDocument();
    expect(screen.getByLabelText("Town")).toHaveValue(record.town);
  });

  it("E2: missing inputs are reported per field (UC-4.5 EX.1)", async () => {
    const user = userEvent.setup();
    api.predict.mockRejectedValueOnce(apiError(fixtures.predictionValidationError, 400));
    renderApp("/predict", { criteria: { town: "TAMPINES" } });
    await user.click(await screen.findByRole("button", { name: "Predict price" }));
    for (const message of Object.values(fixtures.predictionValidationError.error.fields)) {
      expect(await screen.findByText(message)).toBeInTheDocument();
    }
  });

  it("from S2 it pre-fills from the search filters, not from an earlier property", async () => {
    const user = userEvent.setup();
    renderApp("/results", { criteria });
    await user.click(await screen.findByRole("button", { name: "Estimate a price" }));
    expect(await screen.findByText("Pre-filled from your search. Complete the remaining features.")).toBeInTheDocument();
    expect(screen.getByLabelText("Town")).toHaveValue("TAMPINES");
    expect(screen.getByLabelText("Flat type")).toHaveValue("4 ROOM");
    expect(screen.getByLabelText("Floor area")).toHaveValue("");
  });

  it("'Change inputs / predict again' returns to S5 with the values kept", async () => {
    const user = userEvent.setup();
    await openPrediction(user);
    await user.clear(screen.getByLabelText("Floor area"));
    await user.type(screen.getByLabelText("Floor area"), "100");
    await user.click(screen.getByRole("button", { name: "Predict price" }));
    await user.click(await screen.findByRole("button", { name: "Change inputs / predict again" }));
    expect(screen.getByLabelText("Floor area")).toHaveValue("100");
  });
});

describe("S3 Historical Data Page (UC-4.3)", () => {
  it("lists matching transactions and expands a record in place", async () => {
    const user = userEvent.setup();
    renderApp("/history", { criteria });
    expect(await screen.findByText(`${fixtures.history.total.toLocaleString("en-SG")} transactions`)).toBeInTheDocument();
    const [details] = screen.getAllByRole("button", { name: "Show details" });
    await user.click(details);
    expect(api.transaction).toHaveBeenCalledWith(fixtures.history.records[0].id);
    expect(await screen.findByText("Lease commenced")).toBeInTheDocument();
  });

  it("'Back to results' returns to S2 with the same filters", async () => {
    const user = userEvent.setup();
    renderApp("/history", { criteria });
    await user.click(await screen.findByRole("link", { name: "Back to results" }));
    expect(await screen.findByText("Latest resale prices")).toBeInTheDocument();
    expect(api.latest).toHaveBeenLastCalledWith(expect.objectContaining(criteria), 1);
  });
});

describe("S4 Summary Statistics Page (UC-4.4)", () => {
  it("shows the statistics and a labelled trend; period changes refresh it", async () => {
    const user = userEvent.setup();
    renderApp("/summary", { criteria });
    const stats = fixtures.summaryAll;
    expect(await screen.findByText(formatSGD(stats.mean_sgd))).toBeInTheDocument();
    expect(screen.getByText(formatSGD(stats.median_sgd))).toBeInTheDocument();
    expect(screen.getByText(formatSGD(stats.median_psm_sgd))).toBeInTheDocument();
    expect(screen.getByText(`Show the monthly figures (${Object.keys(stats.trend).length} months)`)).toBeInTheDocument();
    expect(screen.getByText("Number of sales by month")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "12 months" }));
    expect(api.summary).toHaveBeenLastCalledWith(expect.objectContaining(criteria), "1y");
    expect(await screen.findByText(formatSGD(fixtures.summary1y.median_sgd))).toBeInTheDocument();
  });

  it("ignores a slow response for a period that is no longer selected", async () => {
    const user = userEvent.setup();
    const pending = {};
    api.summary.mockImplementation(
      (_criteria, period) =>
        new Promise(
          (resolve) =>
            (pending[period] = () => resolve(structuredClone(period === "1y" ? fixtures.summary1y : fixtures.summaryAll))),
        ),
    );
    renderApp("/summary", { criteria });
    await waitFor(() => expect(pending.all).toBeDefined());
    pending.all();
    await screen.findByText(formatSGD(fixtures.summaryAll.median_sgd));
    const firstAll = pending.all;
    await user.click(screen.getByRole("radio", { name: "12 months" }));
    await user.click(screen.getByRole("radio", { name: "Since 2017" }));
    await waitFor(() => expect(pending.all).not.toBe(firstAll));
    pending.all(); // the newer request answers first...
    pending["1y"](); // ...then the stale 12-month one
    await waitFor(() => expect(screen.getByRole("radio", { name: "Since 2017" })).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText(formatSGD(fixtures.summaryAll.median_sgd))).toBeInTheDocument();
    expect(screen.queryByText(formatSGD(fixtures.summary1y.median_sgd))).not.toBeInTheDocument();
  });

  it("shows a no-data message (EX.1)", async () => {
    api.summary.mockResolvedValue(structuredClone(fixtures.summaryEmpty));
    renderApp("/summary", { criteria });
    expect(await screen.findByText("No matching records found")).toBeInTheDocument();
  });
});

describe("Navigation", () => {
  it("the header's 'Price estimate' opens S5 and unknown pages show a not-found page", async () => {
    const user = userEvent.setup();
    renderApp("/nowhere");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Price estimate" }));
    expect(await screen.findByText("Estimate a flat's current fair price")).toBeInTheDocument();
  });
});
