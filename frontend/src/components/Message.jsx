// Page-level message (dialog map: "Errors and warnings appear on the current page").
export default function Message({ kind = "info", title, children, action }) {
  const role = kind === "error" || kind === "warning" ? "alert" : "status";
  return (
    <div className={`message message-${kind}`} role={role}>
      <div>
        {title && <strong className="message-title">{title}</strong>}
        {children && <div className="message-body">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p className="field-error" id={id}>
      {message}
    </p>
  );
}
