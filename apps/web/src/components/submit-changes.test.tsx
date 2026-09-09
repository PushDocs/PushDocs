// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
it("offers a new branch and MR for drafts on the default branch", () => {
  render(<SubmitChanges {...props} />);
  expect(screen.getByLabelText("Новая рабочая ветка").getAttribute("value")).toBe(
    "docs/update-12345678",
  );
  expect(screen.getByRole("button", { name: "Отправить и создать PR / MR" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByLabelText("Новая рабочая ветка")).toBeNull();
  expect(screen.getByRole("button", { name: "Отправить в stable" })).toBeTruthy();
});
it("sends subsequent changes to the existing review without offering another branch", () => {
  render(<SubmitChanges {...props} branch="docs/update" reviewTitle="Existing MR" />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByLabelText("Новая рабочая ветка")).toBeNull();
  expect(screen.getByRole("button", { name: "Отправить в PR / MR" })).toBeTruthy();
});
it("blocks duplicate submissions while a job is running", () => {
  render(<SubmitChanges {...props} disabled submitting />);
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
});
