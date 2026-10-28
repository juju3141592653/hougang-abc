// Small presentational building blocks shared by every page.
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { Link } from "react-router-dom";

const ALERT_ICONS = { error: AlertCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };

/** Page-level message (dialog map: errors and warnings appear on the current page). */
export function Alert({ kind = "info", title, children, action }) {
  const Icon = ALERT_ICONS[kind] || Info;
  const role = kind === "error" || kind === "warning" ? "alert" : "status";
  return (
    <div className={`alert alert-${kind}`} role={role}>
      <Icon size={18} className="alert-icon" aria-hidden="true" />
      <div className="alert-content">
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      <AlertCircle size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

export function BackLink({ to, label }) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeft size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, index) => (
        <span key={item.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, children }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, description, actions, children, className = "", as: Tag = "section", ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function StatTile({ label, value, hint, icon: Icon, small = false, className = "" }) {
  return (
    <div className={`card stat ${className}`}>
      <span className="stat-label">
        {Icon && <Icon size={15} aria-hidden="true" />}
        {label}
      </span>
      <span className={`stat-value${small ? " stat-value-sm" : ""}`}>{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Badge({ tone, children, icon: Icon }) {
  return (
    <span className={`badge${tone ? ` badge-${tone}` : ""}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Skeleton({ width = "100%", height = 14, style, className = "" }) {
  return <span className={`skeleton ${className}`} style={{ width, height, ...style }} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon = Info, title, children, actions }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="form-actions">{actions}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
