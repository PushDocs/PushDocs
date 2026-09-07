import { GitCommitHorizontal } from "lucide-react";

export function PushDocsLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="pushdocs-logo" aria-label="PushDocs" role="img">
      <span className="pushdocs-mark">
        <GitCommitHorizontal aria-hidden size={compact ? 18 : 22} />
      </span>
      <span>PushDocs</span>
    </div>
  );
}
