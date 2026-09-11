// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SettingsProjectPicker } from "./settings-project-picker";

afterEach(cleanup);
it("offers project settings without silently choosing a project", () => {
  render(
    <SettingsProjectPicker
      projects={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
    />,
  );
  for (const [name, id] of [
    ["Alpha", "a"],
    ["Beta", "b"],
  ] as const)
    expect(screen.getByText(name).getAttribute("href")).toBe(`/projects/${id}/settings`);
});
