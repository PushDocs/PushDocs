"use client";
import { useMemo, useState } from "react";
import { DiffViewer } from "./diff-viewer";
import { buildTextDiff } from "./text-diff";

export function planReplacement(source: string, find: string, replacement: string) {
  const parts = find ? source.split(find) : [source];
  return { before: source, after: parts.join(replacement), count: parts.length - 1 };
}

export function ReplacePreview({
  source,
  path,
  find,
  replacement,
  readOnly,
  onApply,
  onCancel,
}: {
  source: string;
  path?: string;
  find: string;
  replacement: string;
  readOnly: boolean;
  onApply: (before: string, after: string) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState(() => planReplacement(source, find, replacement));
  const stale = source !== plan.before;
  const diff = useMemo(() => buildTextDiff(plan.before, plan.after), [plan]);
  const changed = plan.before !== plan.after;
  return (
    <div className="wb-replacement-review">
      <p>Замен: {plan.count}</p>
      {stale ? (
        <div className="wb-notice" role="status">
          Документ изменился. Обновите предпросмотр перед заменой.
          <button type="button" onClick={() => setPlan(planReplacement(source, find, replacement))}>
            Обновить предпросмотр
          </button>
        </div>
      ) : null}
      <DiffViewer
        path={path}
        before={plan.before}
        after={plan.after}
        beforeLabel="Сейчас"
        afterLabel="После замены"
        diff={diff}
      />
      <footer>
        <button type="button" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="wb-primary"
          disabled={readOnly || stale || !changed || !diff}
          onClick={() => {
            if (!readOnly && !stale && changed && diff) onApply(plan.before, plan.after);
          }}
        >
          Заменить все ({plan.count})
        </button>
      </footer>
    </div>
  );
}
