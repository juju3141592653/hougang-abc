import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { ROUTER_FUTURE } from "./App.jsx";
import { FilterProvider } from "./state/FilterContext.jsx";
import "@fontsource-variable/inter";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter future={ROUTER_FUTURE}>
      <FilterProvider>
        <App />
      </FilterProvider>
    </BrowserRouter>
  </StrictMode>,
);
