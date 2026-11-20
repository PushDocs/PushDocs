// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkbenchSearch, WorkbenchSidebar } from "./file-search-state";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

it("restores query, mode, panel and scroll independently for each user, project and branch", () => {
  const hook = renderHook(
    ({ owner, project, branch }) => useWorkbenchSearch(owner, project, branch),
    { initialProps: { owner: "anna", project: "docs", branch: "main" } },
  );
  const saved = {
    matchCase: true,
    wholeWord: true,
    query: "письмо",
    content: false,
    scrollTop: 350,
    panel: WorkbenchSidebar.Search,
  };
  act(() => hook.result.current.updateSearch(saved));
  for (const scope of [
    { owner: "anna", project: "docs", branch: "fix" },
    { owner: "anna", project: "other", branch: "main" },
    { owner: "boris", project: "docs", branch: "main" },
  ]) {
    hook.rerender(scope);
    expect(hook.result.current.search.query).toBe("");
    expect(hook.result.current.search.panel).toBe(WorkbenchSidebar.Files);
    act(() => hook.result.current.updateSearch({ query: "другой запрос" }));
  }
  hook.rerender({ owner: "anna", project: "docs", branch: "main" });
  expect(hook.result.current.search).toEqual(saved);
  hook.unmount();
  const restored = renderHook(() => useWorkbenchSearch("anna", "docs", "main"));
  expect(restored.result.current.search).toEqual(saved);
});

it("keeps search usable when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const { result } = renderHook(() => useWorkbenchSearch(undefined, "docs", "main"));
  act(() => result.current.updateSearch({ query: "письмо", panel: WorkbenchSidebar.Search }));
  expect(result.current.search.query).toBe("письмо");
});

it.each([
  "{invalid",
  "null",
  '{"query":42}',
  '{"query":"x","content":true,"scrollTop":-1,"panel":"search"}',
])("ignores malformed saved search state: %s", (value) => {
  vi.spyOn(Storage.prototype, "getItem").mockReturnValue(value);
  const { result } = renderHook(() => useWorkbenchSearch("anna", "docs", "main"));
  expect(result.current.search).toMatchObject({
    query: "",
    scrollTop: 0,
    panel: WorkbenchSidebar.Files,
  });
});
