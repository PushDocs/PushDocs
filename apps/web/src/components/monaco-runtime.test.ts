// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  document.head.innerHTML = "";
  vi.resetModules();
});

it("shares a local runtime, waits for its styles and routes workers to the same origin", async () => {
  const { loadMonaco } = await import("./monaco-runtime");
  const api = { editor: { defineTheme: vi.fn() } };
  vi.stubGlobal("PushDocsMonaco", api);
  const loaded = loadMonaco();
  expect(loadMonaco()).toBe(loaded);
  const script = document.querySelector("script");
  const style = document.querySelector("link");
  expect(script?.getAttribute("src")).toBe("/monaco/0.56.0/editor.js");
  expect(style?.getAttribute("href")).toBe("/monaco/0.56.0/editor.css");
  script?.dispatchEvent(new Event("load"));
  expect(api.editor.defineTheme).not.toHaveBeenCalled();
  style?.dispatchEvent(new Event("load"));
  expect(await loaded).toBe(api);
  const host = window as unknown as {
    MonacoEnvironment: { getWorkerUrl: (moduleId: string, label: string) => string };
  };
  expect(host.MonacoEnvironment.getWorkerUrl("", "typescript")).toBe("/monaco/0.56.0/ts.worker.js");
  expect(host.MonacoEnvironment.getWorkerUrl("", "json")).toBe("/monaco/0.56.0/json.worker.js");
  expect(host.MonacoEnvironment.getWorkerUrl("", "editorWorkerService")).toBe(
    "/monaco/0.56.0/editor.worker.js",
  );
});

it("cleans up failed assets and allows a later retry", async () => {
  const { loadMonaco } = await import("./monaco-runtime");
  const failed = loadMonaco();
  const rejection = expect(failed).rejects.toThrow("Не удалось загрузить редактор");
  document.querySelector("script")?.dispatchEvent(new Event("error"));
  await rejection;
  expect(document.querySelector("link")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
  const retry = loadMonaco();
  expect(retry).not.toBe(failed);
  const retryRejection = expect(retry).rejects.toThrow();
  document.querySelector("link")?.dispatchEvent(new Event("error"));
  await retryRejection;
});
