// Page controls for TransactionPage results (UC-4.2 AC.2, UC-4.3).
export default function Pagination({ page, totalPages, onChange, label = "Results pages" }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <button type="button" className="button" onClick={() => onChange(1)} disabled={page <= 1}>
        « First
      </button>
      <button type="button" className="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ‹ Previous
      </button>
      <span className="pagination-status">
        Page {page.toLocaleString("en-SG")} of {totalPages.toLocaleString("en-SG")}
      </span>
      <button type="button" className="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        Next ›
      </button>
      <button type="button" className="button" onClick={() => onChange(totalPages)} disabled={page >= totalPages}>
        Last »
      </button>
    </nav>
  );
}
