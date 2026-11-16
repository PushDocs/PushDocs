"use client";

import {
  BranchUpdateStrategy,
  branchUpdateStrategy,
  type ChangeRequestDetails,
} from "@pushdocs/contracts";
import { AlertTriangle, GitMerge, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { listLocalDrafts } from "./draft-storage";
import {
  branchSyncLabels,
  branchUpdateLabels,
  pendingBranchChangesTitle,
} from "./git-operation-labels";
import { GitOperationKind } from "./git-operation-store";
import { useGitOperation } from "./use-git-operation";
import { useLocalDraftChanges } from "./use-local-draft-changes";

export function ReviewBranchUpdate({
  review,
  provider,
  projectId,
  ownerId,
  canWrite,
  activeStrategy,
  activeHeadSha,
  hasPendingChanges = false,
}: {
  projectId: string;
  ownerId: string;
  canWrite: boolean;
  activeStrategy?: BranchUpdateStrategy;
  activeHeadSha?: string;
  hasPendingChanges?: boolean;
  review: {
    id: string;
    head_sha?: string | null;
    source_branch: string;
    target_branch: string;
    provider_url: string;
    details?: ChangeRequestDetails | null;
  };
  provider: "gitlab" | "github";
}) {
  const reviewLabel = provider === "gitlab" ? "MR" : "PR";
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const localChanges = useLocalDraftChanges(projectId, ownerId, review.source_branch);
  const localChangesHref = `/projects/${projectId}/documents?${new URLSearchParams({ branch: review.source_branch })}`;
  const strategy = activeStrategy ?? branchUpdateStrategy(review.details);
  const headSha = activeHeadSha ?? review.head_sha ?? review.details?.headSha;
  const allowed =
    canWrite &&
    !!headSha &&
    (activeStrategy !== undefined || review.details?.source?.isFork === false);
  const { busy, message, error, start } = useGitOperation({
    projectId,
    branch: review.source_branch,
    kind: GitOperationKind.UpdateBranch,
    successMessage: () => "Ветка обновлена и отправлена в Git. Данные PR / MR обновлены.",
    onComplete: () => router.refresh(),
  });
  const pendingChanges = !activeStrategy && !busy && (hasPendingChanges || localChanges);
  async function update() {
    if (!allowed || !headSha || busy || pendingChanges) return;
    if (!activeStrategy && listLocalDrafts(projectId, [review.source_branch], ownerId).length) {
      setLocalError("В этой ветке есть локальные правки. Сначала отправьте их в Git или отмените.");
      setConfirming(false);
      return;
    }
    setLocalError("");
    setConfirming(false);
    await start({
      projectId,
      branch: review.source_branch,
      updateReview: { reviewId: review.id, expectedHeadSha: headSha },
    });
  }
  return (
    <section className="branch-notice branch-update-notice" aria-label="Обновление ветки">
      <AlertTriangle aria-hidden size={20} />
      <div>
        <h2>
          {activeStrategy
            ? "Обновление ветки"
            : pendingChanges
              ? pendingBranchChangesTitle
              : `Ветка отстаёт от ${review.target_branch}`}
        </h2>
        <p>
          {activeStrategy
            ? `Продолжите обновление ${review.source_branch}.`
            : pendingChanges
              ? `Отправьте текущие правки из ${review.source_branch} в Git или отмените их. После этого можно обновить ветку из ${review.target_branch}.`
              : `Обновите ${review.source_branch}, чтобы продолжить слияние ${reviewLabel}.`}
        </p>
        {pendingChanges ? (
          localChanges ? (
            <Link href={localChangesHref}>Открыть локальные правки</Link>
          ) : null
        ) : confirming && !busy ? (
          <div className="branch-update-confirmation">
            <p>
              {activeStrategy ? (
                "PushDocs проверит результат предыдущей отправки и продолжит обновление. Уже отправленный результат повторно не создаётся."
              ) : (
                <>
                  {strategy === BranchUpdateStrategy.Rebase
                    ? `Коммиты ${review.source_branch} будут перенесены поверх ${review.target_branch} (rebase). Их SHA изменятся.`
                    : `Изменения ${review.target_branch} будут влиты в ${review.source_branch} (merge).`}{" "}
                  Результат сразу отправится в Git. {reviewLabel} обновится автоматически и
                  останется открытым.
                </>
              )}
            </p>
            <div className="branch-update-actions">
              <button
                className="pd-button pd-button--primary"
                type="button"
                onClick={() => void update()}
              >
                {branchUpdateLabels.confirm}
              </button>
              <button
                className="pd-button pd-button--secondary"
                type="button"
                onClick={() => setConfirming(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="branch-update-actions">
            <button
              className="pd-button pd-button--primary"
              type="button"
              disabled={busy || !allowed}
              aria-busy={busy}
              title={
                !canWrite
                  ? "Нужны права редактора"
                  : !allowed
                    ? "Исходная ветка недоступна для обновления"
                    : undefined
              }
              onClick={() => {
                setLocalError("");
                setConfirming(true);
              }}
            >
              {busy ? (
                <LoaderCircle className="spin" aria-hidden size={15} />
              ) : (
                <GitMerge aria-hidden size={15} />
              )}
              {busy
                ? branchSyncLabels.busy
                : activeStrategy
                  ? branchUpdateLabels.resume
                  : branchUpdateLabels.idle}
            </button>
          </div>
        )}
        {localError ? (
          <p role="alert">
            {localError} <Link href={localChangesHref}>Открыть локальные правки</Link>
          </p>
        ) : null}
        {message ? <p role={error ? "alert" : "status"}>{message}</p> : null}
      </div>
    </section>
  );
}
