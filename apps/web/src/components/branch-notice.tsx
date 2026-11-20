import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export function BranchNotice({
  label,
  title,
  action,
  message,
  className = "",
  actionOnly = false,
}: {
  label: string;
  title: string;
  action?: ReactNode;
  message?: ReactNode;
  className?: string;
  actionOnly?: boolean;
}) {
  if (actionOnly && !action && !message) return null;
  if (actionOnly)
    return (
      <>
        <fieldset className="review-branch-action" aria-label={label}>
          {action}
        </fieldset>
        {message ? <div className="branch-action-message">{message}</div> : null}
      </>
    );
  return (
    <section className={`branch-notice ${className}`} aria-label={label}>
      <AlertTriangle aria-hidden size={18} />
      <h2>{title}</h2>
      {action}
      {message ? <div className="branch-notice-message">{message}</div> : null}
    </section>
  );
}
