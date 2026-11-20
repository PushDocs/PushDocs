import type { GitTransferProgress } from "@pushdocs/contracts";
import { LoaderCircle } from "lucide-react";

const megabyteBytes = 1_000_000;
const megabytes = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function GitTransferStatus({
  label,
  transfer,
  ariaLabel,
}: {
  label: string;
  transfer?: GitTransferProgress;
  ariaLabel?: string;
}) {
  const total = transfer?.totalBytes;
  const received = transfer
    ? ` (загружено ${megabytes.format(transfer.receivedBytes / megabyteBytes)}${total ? ` из ${megabytes.format(total / megabyteBytes)}` : ""} МБ)`
    : "";
  return (
    <p
      className="git-transfer-status"
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle className="spin" size={16} aria-hidden />
      {label}
      {received}
    </p>
  );
}
