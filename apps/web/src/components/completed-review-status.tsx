import { GitMerge, GitPullRequestClosed } from "lucide-react";
import type { ReactNode } from "react";

export function CompletedReviewStatus({
  state,
  title,
  targetBranch,
  url,
  reviewLabel,
  children,
}: {
  state: "merged" | "closed";
  title: string;
  targetBranch: string;
  url: string;
  reviewLabel: string;
  children?: ReactNode;
}) {
  const merged = state === "merged";
  return (
    <section className={`empty-state${merged ? " empty-state--merged" : ""}`}>
      {merged ? <GitMerge aria-hidden /> : <GitPullRequestClosed aria-hidden />}
      <h2>
        {reviewLabel} {merged ? "влит" : "закрыт"}
      </h2>
      <p>
        {title}
        <br />
        {merged ? "Изменения влиты в ветку" : "Изменения не влиты в ветку"}{" "}
        <strong>{targetBranch}</strong>.
      </p>
      <a className="pd-button pd-button--primary" href={url} target="_blank" rel="noreferrer">
        Открыть {reviewLabel}
      </a>
      {children}
    </section>
  );
}
