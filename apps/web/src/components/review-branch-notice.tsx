import {
  type ChangeRequestDetails,
  hasBranchConflicts,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { projectChangesHref } from "@/lib/project-paths";

export function ReviewBranchNotice({
  projectId,
  review,
  activeUpdate = false,
}: {
  projectId: string;
  review: {
    source_branch: string;
    target_branch: string;
    details?: ChangeRequestDetails | null;
  };
  activeUpdate?: boolean;
}) {
  const conflicts = hasBranchConflicts(review.details?.readiness.reason);
  if (!conflicts && !needsBranchUpdate(review.details) && !activeUpdate) return null;
  const canOpenChanges = activeUpdate || review.details?.source?.isFork === false;
  return (
    <section className="branch-notice branch-notice--compact" aria-label="Состояние ветки">
      <AlertTriangle aria-hidden size={18} />
      <strong>
        {activeUpdate
          ? "Обновление ветки не завершено"
          : conflicts
            ? `Ветка конфликтует с ${review.target_branch}`
            : `Ветка отстаёт от ${review.target_branch}`}
      </strong>
      {canOpenChanges ? (
        <Link href={projectChangesHref(projectId, review.source_branch)}>Перейти к изменениям</Link>
      ) : (
        <span className="muted">
          {review.details?.source?.isFork ? "Ветка находится в форке" : "Обновите данные из Git"}
        </span>
      )}
    </section>
  );
}
