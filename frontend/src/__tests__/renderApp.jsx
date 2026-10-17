import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App, { ROUTER_FUTURE } from "../App.jsx";
import { FilterProvider } from "../state/FilterContext.jsx";

/** Render the whole app at `path`, optionally with shared filter state already set. */
export function renderApp(path = "/", { criteria, record } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <FilterProvider initialCriteria={criteria} initialRecord={record}>
        <App />
      </FilterProvider>
    </MemoryRouter>,
  );
}
