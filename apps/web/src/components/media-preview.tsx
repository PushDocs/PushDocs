"use client";

import { FileText } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AssetVideo } from "./asset-video";
import { ThumbnailLoader } from "./thumbnail-loader";

const PreviewContext = createContext<{
  loader: ThumbnailLoader;
  idle: boolean;
  scrollRef: RefObject<HTMLElement | null>;
} | null>(null);

export function MediaPreviewProvider({
  scrollRef,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [loader] = useState(() => new ThumbnailLoader());
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scrolling = () => {
      loader.setPaused(true);
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIdle(true);
        loader.setPaused(false);
      }, 150);
    };
    const element = scrollRef.current;
    element?.addEventListener("scroll", scrolling, { passive: true });
    scrolling();
    return () => {
      clearTimeout(timer);
      element?.removeEventListener("scroll", scrolling);
      loader.dispose();
    };
  }, [loader, scrollRef]);
  return <PreviewContext value={{ loader, idle, scrollRef }}>{children}</PreviewContext>;
}

export function MediaPreview({ src, path }: { src: string; path: string }) {
  const context = useContext(PreviewContext);
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const video = /\.mp4$/i.test(path);
  const svg = /\.svg$/i.test(path);
  const name = path.split("/").at(-1) ?? path;
  const loader = context?.loader;
  const scrollRef = context?.scrollRef;
  const idle = context?.idle ?? false;
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { root: scrollRef?.current, rootMargin: "0px" },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [scrollRef]);
  useEffect(() => {
    if (!visible) setEnabled(false);
    else if (idle) setEnabled(true);
  }, [visible, idle]);
  useEffect(() => {
    setImage(undefined);
    setFailed(false);
    if (!enabled || video || svg || !loader) return;
    return loader.subscribe(src, setImage, () => setFailed(true));
  }, [enabled, src, video, svg, loader]);
  return (
    <div className="media-preview" ref={container}>
      {video ? (
        <AssetVideo src={src} name={name} thumbnail loadPreview={enabled} />
      ) : !failed && (svg ? enabled : image) ? (
        // SVG must retain the authenticated response's CSP and disposition headers.
        // biome-ignore lint/performance/noImgElement: authenticated media and session-local raster blobs
        <img src={svg ? src : image} alt={name} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="media-placeholder" role="img" aria-label={`Превью ${name}`}>
          <FileText aria-hidden size={30} />
          {failed ? <small>Превью недоступно</small> : null}
        </span>
      )}
    </div>
  );
}
