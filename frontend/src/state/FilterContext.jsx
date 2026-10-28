// Shared filter state (architecture: "shared filter state preserves the housing criteria").
// Holds the FilterCriteria chosen on S1 so "Back" keeps the filters on every page. Kept in
// sessionStorage so a refresh doesn't lose them; storage failures (private mode) fall back to memory.
// The property a prediction is pre-filled from travels in the navigation state instead (S2a -> S5),
// so an old selection can never leak into a later prediction (decisions #28).
import { createContext, useCallback, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "hougang.filters.v2";
export const EMPTY_CRITERIA = { town: "", flat_type: "", storey_range: "", floor_area_sqm: "", flat_model: "" };

const FilterContext = createContext(null);

function readStored() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
    if (stored && typeof stored === "object") return { ...EMPTY_CRITERIA, ...stored };
  } catch {
    /* ignore */
  }
  return EMPTY_CRITERIA;
}

function writeStored(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function FilterProvider({ children, initialCriteria }) {
  const [criteria, setState] = useState(() =>
    initialCriteria ? { ...EMPTY_CRITERIA, ...initialCriteria } : readStored(),
  );

  const setCriteria = useCallback((next) => {
    const value = { ...EMPTY_CRITERIA, ...next };
    writeStored(value);
    setState(value);
  }, []);

  const value = useMemo(() => ({ criteria, setCriteria }), [criteria, setCriteria]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) throw new Error("useFilters must be used inside FilterProvider");
  return context;
}
