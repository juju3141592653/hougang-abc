// Routes follow the dialog map (docs/design_reference.md, page 2). React Router selects the page;
// FilterProvider holds the shared filter state, so "Back to results" keeps the selected filters.
import { Compass } from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { EmptyState } from "./components/ui.jsx";
import AdminUI from "./pages/AdminUI.jsx";
import HistoricalDataPageUI from "./pages/HistoricalDataPageUI.jsx";
import HomeSearchPageUI from "./pages/HomeSearchPageUI.jsx";
import PredictionPageUI from "./pages/PredictionPageUI.jsx";
import PropertyDetailsPageUI from "./pages/PropertyDetailsPageUI.jsx";
import ResultsPageUI from "./pages/ResultsPageUI.jsx";
import SummaryPageUI from "./pages/SummaryPageUI.jsx";

// Opt in to React Router v7 behaviour now (no relative links are used inside splat routes).
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomeSearchPageUI />} /> {/* S1, E1 */}
        <Route path="/results" element={<ResultsPageUI />} /> {/* S2 */}
        <Route path="/results/:id" element={<PropertyDetailsPageUI />} /> {/* S2a */}
        <Route path="/history" element={<HistoricalDataPageUI />} /> {/* S3 */}
        <Route path="/summary" element={<SummaryPageUI />} /> {/* S4 */}
        <Route path="/predict" element={<PredictionPageUI />} /> {/* S5, E2, S6 */}
        <Route path="/admin/*" element={<AdminUI />} /> {/* S7-S10, S9a, E3, E4 */}
        <Route
          path="*"
          element={
            <div className="container not-found">
              <EmptyState
                icon={Compass}
                title="Page not found"
                actions={
                  <Link className="btn btn-primary" to="/">
                    Start a new search
                  </Link>
                }
              >
                The page you were looking for doesn't exist or has moved.
              </EmptyState>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
