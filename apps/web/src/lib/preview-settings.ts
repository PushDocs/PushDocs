export function previewSettings() {
  const portFrom = Number(process.env.PUSHDOCS_PREVIEW_PORT_FROM ?? 43000);
  const portTo = Number(process.env.PUSHDOCS_PREVIEW_PORT_TO ?? 43019);
  if (
    !Number.isInteger(portFrom) ||
    !Number.isInteger(portTo) ||
    portFrom < 1024 ||
    portTo > 65535 ||
    portFrom > portTo ||
    portTo - portFrom > 99
  )
    throw new Error("Диапазон портов предпросмотра настроен неверно");
  const host = process.env.PUSHDOCS_PREVIEW_PUBLIC_HOST ?? "213.148.1.118";
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error("Адрес предпросмотра настроен неверно");
  return { host, portFrom, portTo };
}
