// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { RealtimeRefresh } from "./realtime-refresh";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, EventListener>();
  readonly url: string;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.(new Event(type));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
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
    expect(source?.url).toBe("/events");
    expect(source?.listeners.size).toBe(12);
    source?.dispatch("comment.created");
    source?.dispatch("document.created");
    act(() => vi.advanceTimersByTime(179));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mounted.unmount();
    expect(source?.close).toHaveBeenCalledOnce();
  });
});
