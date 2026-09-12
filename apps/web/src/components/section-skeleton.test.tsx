// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import LoadingProject from "@/app/(app)/projects/[projectId]/loading";

afterEach(cleanup);
it("announces section loading without a native progress bar or focusable placeholders", () => {
  const { container } = render(<LoadingProject />);
  expect(screen.getByRole("status", { name: "Загрузка раздела" }).getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(container.querySelector("progress")).toBeNull();
  expect(container.querySelectorAll("button, input, a, [tabindex]").length).toBe(0);
  expect(container.querySelectorAll(".skeleton-block").length).toBeGreaterThan(5);
});
