// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaPreview, MediaPreviewProvider } from "./media-preview";

let observed: Array<{
  element: Element;
  callback: (entries: Array<{ isIntersecting: boolean }>) => void;
  root: Element | null;
}>;
beforeEach(() => {
  vi.useFakeTimers();
  observed = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (entries: Array<{ isIntersecting: boolean }>) => void,
        private options: { root: Element | null },
      ) {}
      observe(element: Element) {
        observed.push({ element, callback: this.callback, root: this.options.root });
      }
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["png"]))),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:thumbnail");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Gallery({ extension = "png", revision = 1 }: { extension?: string; revision?: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} data-testid="scroll">
      <MediaPreviewProvider key={revision} scrollRef={scrollRef}>
        <MediaPreview path={`a.${extension}`} src={`/assets/a.${extension}?revision=${revision}`} />
      </MediaPreviewProvider>
    </div>
  );
}
function intersect(visible: boolean) {
  act(() => {
    observed.at(-1)?.callback([{ isIntersecting: visible }]);
  });
}
async function waitIdle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

it("loads only after visibility and scroll idle, preserving SVG response protections", async () => {
  render(<Gallery extension="svg" />);
  const scroll = screen.getByTestId("scroll");
  expect(observed[0]?.root).toBe(scroll);
  intersect(true);
  await act(() => vi.advanceTimersByTimeAsync(100));
  fireEvent.scroll(scroll);
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(document.querySelector("img")).toBeNull();
  await waitIdle();
  expect(screen.getByRole("img", { name: "a.svg" }).getAttribute("src")).toBe(
    "/assets/a.svg?revision=1",
  );
  expect(fetch).not.toHaveBeenCalled();
  intersect(false);
  expect(document.querySelector("img")).toBeNull();
});

it("keeps a visible image through scrolling, reuses it on return, and invalidates on revision", async () => {
  const { rerender } = render(<Gallery />);
  intersect(true);
  await waitIdle();
  const image = screen.getByRole("img", { name: "a.png" });
  expect(image.getAttribute("src")).toBe("blob:thumbnail");
  fireEvent.scroll(screen.getByTestId("scroll"));
  expect(screen.getByRole("img", { name: "a.png" })).toBe(image);
  intersect(false);
  await waitIdle();
  intersect(true);
  expect(screen.getByRole("img", { name: "a.png" }).getAttribute("src")).toBe("blob:thumbnail");
  expect(fetch).toHaveBeenCalledTimes(1);
  rerender(<Gallery revision={2} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail");
  intersect(true);
  await waitIdle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/assets/a.png?revision=2");
});

it("aborts an invisible raster and ignores its late response", async () => {
  let resolve: (response: Response) => void = () => {};
  vi.mocked(fetch).mockImplementation(() => new Promise((next) => (resolve = next)));
  render(<Gallery />);
  intersect(true);
  await waitIdle();
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  intersect(false);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(new Response(new Blob(["stale"]))));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(document.querySelector("img")).toBeNull();
});

it("keeps a fallback when fetching or decoding a thumbnail fails", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
  render(<Gallery />);
  intersect(true);
  await waitIdle();
  expect(screen.getByText("Превью недоступно")).toBeTruthy();
  intersect(false);
  intersect(true);
  await act(async () => {});
  fireEvent.error(screen.getByRole("img", { name: "a.png" }));
  expect(screen.getByText("Превью недоступно")).toBeTruthy();
});
