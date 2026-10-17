// Housing filter controls (UC-4.1): town first, then the dependent filters for that town.
// Used on S1 and, in compact form, on S3 and S4 ("changing filters refreshes the table / analysis").
// Field-specific errors (E1) are shown under each field and the inputs are kept for correction.
import { useEffect, useState } from "react";
import { EMPTY_CRITERIA } from "../state/FilterContext.jsx";
import Message, { FieldError } from "./Message.jsx";
import { titleCase } from "./format.js";

export default function FilterForm({
  value,
  onApply,
  loadOptions,
  errors = {},
  submitLabel = "Apply filters",
  compact = false,
  busy = false,
}) {
  const [form, setForm] = useState({ ...EMPTY_CRITERIA, ...value });
  const [towns, setTowns] = useState([]);
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => setForm({ ...EMPTY_CRITERIA, ...value }), [value]);

  useEffect(() => {
    let active = true;
    loadOptions("")
      .then((result) => {
        if (!active) return;
        setTowns(result.towns || []);
        setLoadError("");
      })
      .catch((error) => active && setLoadError(error.message));
    return () => {
      active = false;
    };
  }, [loadOptions]);

  useEffect(() => {
    let active = true;
    setOptions(null);
    if (form.town) {
      loadOptions(form.town)
        .then((result) => {
          if (!active) return;
          setOptions(result);
          setLoadError("");
        })
        .catch((error) => active && setLoadError(error.message));
    }
    return () => {
      active = false;
    };
  }, [form.town, loadOptions]);

  // UC-4.1 AC.1: changing the town resets the dependent filters.
  const changeTown = (town) => setForm({ ...EMPTY_CRITERIA, town });
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = (event) => {
    event.preventDefault();
    onApply({ ...form, floor_area_sqm: String(form.floor_area_sqm ?? "").trim() });
  };

  const dependentDisabled = !form.town || !options;
  const select = (field, label, list, anyLabel, render = (v) => v) => (
    <div className="field">
      <label htmlFor={`filter-${field}`}>{label}</label>
      <select
        id={`filter-${field}`}
        value={form[field]}
        onChange={change(field)}
        disabled={dependentDisabled}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? `filter-${field}-error` : undefined}
      >
        <option value="">{anyLabel}</option>
        {(list || []).map((item) => (
          <option key={item} value={item}>
            {render(item)}
          </option>
        ))}
      </select>
      <FieldError id={`filter-${field}-error`} message={errors[field]} />
    </div>
  );

  return (
    <form className={`filter-form${compact ? " filter-form-compact" : ""}`} onSubmit={submit} noValidate>
      {loadError && (
        <Message kind="error" title="Search is temporarily unavailable">
          {loadError}
        </Message>
      )}
      <div className="filter-grid">
        <div className="field">
          <label htmlFor="filter-town">
            Town <span className="required">*</span>
          </label>
          <select
            id="filter-town"
            value={form.town}
            onChange={(event) => changeTown(event.target.value)}
            aria-invalid={Boolean(errors.town)}
            aria-describedby={errors.town ? "filter-town-error" : undefined}
          >
            <option value="">Select a town</option>
            {towns.map((town) => (
              <option key={town} value={town}>
                {titleCase(town)}
              </option>
            ))}
          </select>
          <FieldError id="filter-town-error" message={errors.town} />
        </div>
        {select("flat_type", "Flat type", options?.flat_types, "Any flat type", titleCase)}
        {select("storey_range", "Storey range", options?.storey_ranges, "Any storey", (s) => s.toLowerCase())}
        {select("flat_model", "Flat model", options?.flat_models, "Any flat model")}
        <div className="field">
          <label htmlFor="filter-floor_area_sqm">Floor area (sqm)</label>
          <input
            id="filter-floor_area_sqm"
            type="text"
            inputMode="decimal"
            placeholder={options ? `${options.floor_area_min}–${options.floor_area_max}` : "e.g. 93"}
            value={form.floor_area_sqm}
            onChange={change("floor_area_sqm")}
            disabled={!form.town}
            aria-invalid={Boolean(errors.floor_area_sqm)}
            aria-describedby="filter-floor_area_sqm-hint"
          />
          <p className="field-hint" id="filter-floor_area_sqm-hint">
            Matches flats within ±{options?.floor_area_tolerance_sqm ?? 5} sqm
          </p>
          <FieldError message={errors.floor_area_sqm} />
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Searching…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
