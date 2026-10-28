// Housing filter controls (UC-4.1). Town first; its flat types next; a town + flat type then narrow
// the storey ranges, flat models and floor-area range to combinations that have sales (SRS 4.1:
// "filter options shall update dynamically based on the user's prior selections").
// Used on S1 (variant "hero") and to refine S3 / S4 (variant "panel"). Field-specific errors (E1)
// appear under each field and the inputs are kept for correction.
import { RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { EMPTY_CRITERIA } from "../state/FilterContext.jsx";
import { flatTypeLabel, titleCase } from "./format.js";
import { Alert, FieldError, Spinner } from "./ui.jsx";

export default function FilterForm({
  value,
  onApply,
  loadOptions,
  errors = {},
  submitLabel = "Apply filters",
  variant = "panel",
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

  // Options for the chosen town (and flat type, if any).
  useEffect(() => {
    let active = true;
    setOptions(null);
    if (form.town) {
      loadOptions(form.town, form.flat_type)
        .then((result) => {
          if (!active) return;
          setOptions(result);
          setLoadError("");
          // A storey range or flat model the new flat type doesn't have would only give "no results".
          setForm((current) => ({
            ...current,
            storey_range: result.storey_ranges.includes(current.storey_range) ? current.storey_range : "",
            flat_model: result.flat_models.includes(current.flat_model) ? current.flat_model : "",
          }));
        })
        .catch((error) => active && setLoadError(error.message));
    }
    return () => {
      active = false;
    };
  }, [form.town, form.flat_type, loadOptions]);

  // UC-4.1 AC.1: changing the town resets the dependent filters.
  const changeTown = (town) => setForm({ ...EMPTY_CRITERIA, town });
  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const clearOptional = () => setForm({ ...EMPTY_CRITERIA, town: form.town });

  const submit = (event) => {
    event.preventDefault();
    onApply({ ...form, floor_area_sqm: String(form.floor_area_sqm ?? "").trim() });
  };

  const dependentDisabled = !form.town || !options;
  const tolerance = options?.floor_area_tolerance_sqm ?? 5;
  const select = (field, label, list, anyLabel, render = (v) => v) => (
    <div className="field">
      <label htmlFor={`filter-${field}`}>{label}</label>
      <select
        id={`filter-${field}`}
        className="control"
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

  const hasOptional = form.flat_type || form.storey_range || form.flat_model || form.floor_area_sqm;

  return (
    <form className={`filter-form filter-form-${variant}`} onSubmit={submit} noValidate>
      {loadError && (
        <Alert kind="error" title="Search is temporarily unavailable">
          {loadError}
        </Alert>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="filter-town">
            Town<span className="required">*</span>
          </label>
          <select
            id="filter-town"
            className="control"
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
        {select("flat_type", "Flat type", options?.flat_types, "Any flat type", flatTypeLabel)}
        {select("storey_range", "Storey range", options?.storey_ranges, "Any storey", (s) => s.toLowerCase())}
        {select("flat_model", "Flat model", options?.flat_models, "Any flat model")}
        <div className="field">
          <label htmlFor="filter-floor_area_sqm">Floor area</label>
          <div className="input-affix">
            <input
              id="filter-floor_area_sqm"
              className="control"
              type="text"
              inputMode="decimal"
              placeholder={options ? `${Math.round(options.floor_area_min)}–${Math.round(options.floor_area_max)}` : "e.g. 93"}
              value={form.floor_area_sqm}
              onChange={change("floor_area_sqm")}
              disabled={!form.town}
              aria-invalid={Boolean(errors.floor_area_sqm)}
              aria-describedby="filter-floor_area_sqm-hint"
            />
            <span className="affix">sqm</span>
          </div>
          {errors.floor_area_sqm ? (
            <FieldError message={errors.floor_area_sqm} />
          ) : (
            <span className="field-hint" id="filter-floor_area_sqm-hint">
              Matches flats within ±{tolerance} sqm
            </span>
          )}
        </div>
      </div>
      <div className="form-actions">
        {variant === "hero" && (
          <span className="subtle">Only the town is required. Other filters narrow the results.</span>
        )}
        <div className="form-actions" style={{ marginLeft: variant === "hero" ? "auto" : 0 }}>
          {hasOptional && (
            <button type="button" className="btn btn-ghost" onClick={clearOptional}>
              <RotateCcw size={15} aria-hidden="true" />
              Clear filters
            </button>
          )}
          <button type="submit" className={`btn btn-primary${variant === "hero" ? " btn-lg" : ""}`} disabled={busy}>
            {busy ? <Spinner /> : <Search size={17} aria-hidden="true" />}
            {busy ? "Searching…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
