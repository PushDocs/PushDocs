// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssetVideo } from "./asset-video";

afterEach(cleanup);

it("opens a playable video at an initial frame and reports decoding errors", () => {
  render(<AssetVideo src="/private/demo.mp4" name="demo.mp4" />);
  const video = screen.getByLabelText("Видео demo.mp4") as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.autoplay).toBe(false);
  expect(video.preload).toBe("metadata");
  expect(video.getAttribute("src")).toBe("/private/demo.mp4");
  Object.defineProperty(video, "duration", { value: 0.1 });
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(0.05);
  fireEvent.error(video);
  expect(screen.getByRole("status").textContent).toContain("Скачайте файл для просмотра");
  expect(screen.queryByLabelText("Видео demo.mp4")).toBeNull();
});

it("loads a silent thumbnail only near the viewport and keeps a fallback on failure", () => {
  let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const { unmount } = render(<AssetVideo src="/private/demo.mp4" name="demo.mp4" thumbnail />);
  const preview = screen.getByRole("figure", { name: "Превью видео demo.mp4" });
  expect(observe).toHaveBeenCalledWith(preview);
  expect(preview.querySelector("video")).toBeNull();
  act(() => intersect?.([{ isIntersecting: false }]));
  expect(preview.querySelector("video")).toBeNull();
  act(() => intersect?.([{ isIntersecting: true }]));
  const video = preview.querySelector("video");
  expect(video).not.toBeNull();
  expect(video?.controls).toBe(false);
  expect(video?.muted).toBe(true);
  fireEvent.loadedData(video as HTMLVideoElement);
  expect(preview.dataset.ready).toBe("true");
  fireEvent.error(video as HTMLVideoElement);
  expect(preview.dataset.ready).toBe("false");
  expect(preview.textContent).toContain("Превью недоступно");
  expect(preview.querySelector("video")).toBeNull();
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
