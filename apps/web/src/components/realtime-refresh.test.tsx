// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/project/documents",
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { RealtimeRefresh } from "./realtime-refresh";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, EventListener>();
  readonly url: string;
  close = vi.fn();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  dispatch(type: string, data = {}): void {
    this.listeners.get(type)?.(
      new MessageEvent(type, { data: JSON.stringify({ projectId: "project", ...data }) }),
    );
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RealtimeRefresh", () => {
  it("refreshes once after a burst of relevant events", () => {
    const mounted = render(<RealtimeRefresh />);
    const source = FakeEventSource.instances[0];
    expect(source?.url).toBe("/events?projectId=project");
    expect(source?.listeners.size).toBe(13);
    expect(source?.listeners.has("files.staged")).toBe(true);
    source?.dispatch("comment.created");
    source?.dispatch("document.created");
    act(() => vi.advanceTimersByTime(200));
    expect(mocks.refresh).not.toHaveBeenCalled();
    source?.dispatch("change-set.submitted");
    act(() => vi.advanceTimersByTime(179));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(source?.close).toHaveBeenCalledOnce();
  });

  it("shows the connection state and clears it after reconnecting", () => {
    render(<RealtimeRefresh />);
    const source = FakeEventSource.instances[0];
    act(() => source?.onerror?.());
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Связь с сервером прервана",
    );
    act(() => source?.onopen?.());
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
