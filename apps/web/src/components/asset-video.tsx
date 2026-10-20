"use client";

import { FileVideo, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function AssetVideo({
  src,
  name,
  thumbnail = false,
  loadPreview = true,
}: {
  src: string;
  name: string;
  thumbnail?: boolean;
  loadPreview?: boolean;
}) {
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loadPreview) setReady(false);
  }, [loadPreview]);

  useEffect(() => {
    if (!thumbnail) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [thumbnail]);

  return (
    <figure
      ref={container}
      className={`asset-video${thumbnail ? " asset-video-thumbnail" : ""}`}
      data-ready={ready}
      aria-label={thumbnail ? `Превью видео ${name}` : undefined}
    >
      {thumbnail ? (
        <span className="asset-video-placeholder" aria-hidden>
          <FileVideo aria-hidden size={30} />
          {failed ? <small>Превью недоступно</small> : null}
        </span>
      ) : failed ? (
        <p role="status">Не удалось воспроизвести видео. Скачайте файл для просмотра.</p>
      ) : null}
      {visible && loadPreview && !failed ? (
        <video
          src={src}
          aria-label={thumbnail ? undefined : `Видео ${name}`}
          aria-hidden={thumbnail || undefined}
          controls={!thumbnail}
          muted={thumbnail}
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (Number.isFinite(video.duration) && video.duration > 0) {
              video.currentTime = Math.min(0.1, video.duration / 2);
            }
          }}
          onLoadedData={() => setReady(true)}
          onSeeked={() => setReady(true)}
          onError={() => {
            setReady(false);
            setFailed(true);
          }}
        />
      ) : null}
      {thumbnail ? (
        <span className="asset-video-badge" aria-hidden>
          <Play size={12} fill="currentColor" /> MP4
        </span>
      ) : null}
    </figure>
  );
}
