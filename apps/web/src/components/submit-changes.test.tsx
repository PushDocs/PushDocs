// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ submitChangeSetAction: vi.fn() }));

import { SubmitChanges } from "./submit-changes";

afterEach(cleanup);
const props = {
  projectId: "project",
  changeSetId: "12345678-rest",
  branch: "stable",
  defaultBranch: "stable",
  disabled: false,
  submitting: false,
};
it("always creates an MR and generates the working branch without extra controls", () => {
  const { container } = render(<SubmitChanges {...props} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByLabelText("Рабочая ветка для изменений")).toBeNull();
  expect(screen.queryByText(/MR в ветку/i)).toBeNull();
  expect(container.querySelector('input[name="createReview"]')?.getAttribute("value")).toBe("on");
  expect(container.querySelector('input[name="newBranch"]')?.getAttribute("value")).toBe(
    "docs/update-12345678",
  );
  expect(screen.getByRole("button", { name: "Отправить и создать PR / MR" })).toBeTruthy();
});
it("sends subsequent changes to the existing review without offering another branch", () => {
  const { container } = render(
    <SubmitChanges {...props} branch="docs/update" reviewTitle="Existing MR" />,
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByLabelText("Рабочая ветка для изменений")).toBeNull();
  expect(container.querySelector('input[name="createReview"]')?.getAttribute("value")).toBe("on");
  expect(container.querySelector('input[name="newBranch"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Отправить в PR / MR" })).toBeTruthy();
});
it("blocks duplicate submissions while a job is running", () => {
  render(<SubmitChanges {...props} disabled submitting />);
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
});
