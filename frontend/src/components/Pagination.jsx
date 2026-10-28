// Numbered page controls for TransactionPage results (UC-4.2 AC.2, UC-4.3).
import { ChevronLeft, ChevronRight } from "lucide-react";

/** 1 … 4 5 [6] 7 8 … 29 */
function pageNumbers(page, total) {
  const pages = new Set([1, total, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => pages.add(n));
  if (page >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => pages.add(n));
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1] > 1) out.push(`gap-${n}`);
    out.push(n);
  });
  return out;
}

export default function Pagination({ page, totalPages, onChange, label = "Results pages" }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <button type="button" className="page-btn" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        <ChevronLeft size={16} aria-hidden="true" />
        Previous
      </button>
      {pageNumbers(page, totalPages).map((item) =>
        typeof item === "string" ? (
          <span key={item} className="page-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className="page-btn"
            aria-current={item === page ? "page" : undefined}
            aria-label={`Page ${item}`}
            onClick={() => item !== page && onChange(item)}
          >
            {item.toLocaleString("en-SG")}
          </button>
        ),
      )}
      <button type="button" className="page-btn" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>
        Next
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
