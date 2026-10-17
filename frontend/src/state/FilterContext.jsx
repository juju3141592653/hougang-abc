// Shared filter state (architecture: "shared filter state preserves the housing criteria").
// Holds the FilterCriteria chosen on S1 and the record selected on S2, so "Back to results" keeps
// the filters and S5 can pre-fill from the selected property. Kept in sessionStorage so a page
// refresh doesn't lose them; storage failures (private mode) fall back to memory only.
import { createContext, useCallback, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "hougang.filters.v1";
export const EMPTY_CRITERIA = { town: "", flat_type: "", storey_range: "", floor_area_sqm: "", flat_model: "" };

const FilterContext = createContext(null);

function readStored() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
    if (stored && typeof stored === "object") {
      return {
        criteria: { ...EMPTY_CRITERIA, ...(stored.criteria || {}) },
        selectedRecord: stored.selectedRecord || null,
      };
    }
  } catch {
    /* ignore */
  }
  return { criteria: EMPTY_CRITERIA, selectedRecord: null };
}

function writeStored(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function FilterProvider({ children, initialCriteria, initialRecord }) {
  const [state, setState] = useState(() => {
    if (initialCriteria || initialRecord) {
      return { criteria: { ...EMPTY_CRITERIA, ...(initialCriteria || {}) }, selectedRecord: initialRecord || null };
    }
    return readStored();
  });

  const update = useCallback((patch) => {
    setState((previous) => {
      const next = { ...previous, ...patch };
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      criteria: state.criteria,
      selectedRecord: state.selectedRecord,
      setCriteria: (criteria) => update({ criteria: { ...EMPTY_CRITERIA, ...criteria } }),
      setSelectedRecord: (selectedRecord) => update({ selectedRecord }),
    }),
    [state, update],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) throw new Error("useFilters must be used inside FilterProvider");
  return context;
}
