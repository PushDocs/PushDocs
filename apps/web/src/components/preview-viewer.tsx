"use client";

import { useState } from "react";
import { LivePreviewButton } from "./live-preview-button";

export function PreviewViewer({ projectId, branch }: { projectId: string; branch: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const canEmbed = url && !(window.location.protocol === "https:" && url.startsWith("http:"));
  return (
    <>
      <LivePreviewButton projectId={projectId} branch={branch} onReady={setUrl} />
      {canEmbed ? (
        <iframe className="preview-site" src={url} title={`Предпросмотр ветки ${branch}`} />
      ) : (
        <p className="panel-note">
          После запуска откройте сайт кнопкой выше. Эта вкладка поддерживает работу предпросмотра,
          пока вы смотрите сайт.
        </p>
      )}
    </>
  );
}
