// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SubmitChanges } from "./submit-changes";

afterEach(cleanup);
const props = {
  action: vi.fn(async () => {}),
  projectId: "project",
  changeSetId: "12345678-rest",
  branch: "stable",
  defaultBranch: "stable",
  disabled: false,
  submitting: false,
};
it("always creates an MR and generates the working branch without extra controls", () => {
  const { container } = render(<SubmitChanges {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить изменения" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Отправить изменения" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByLabelText("Рабочая ветка для изменений")).toBeNull();
  expect(container.querySelector('input[name="createReview"]')?.getAttribute("value")).toBe("on");
  expect(container.querySelector('input[name="newBranch"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Отправить в PR / MR" })).toBeTruthy();
});
it("blocks duplicate submissions while a job is running", () => {
  render(<SubmitChanges {...props} disabled submitting />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить изменения" }));
  expect(
    screen.getByRole("button", { name: "Отправляем изменения…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
});

it("opens the form only on request and closes it without affecting the page", () => {
  render(<SubmitChanges {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Отправить изменения" }));
  expect(screen.getByRole("dialog", { name: "Отправить изменения" })).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Название PR / MR и сообщение коммита" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Отправить изменения" })).toBeTruthy();
});
it("prevents sending when the user has no access or unresolved conflicts", () => {
  render(<SubmitChanges {...props} disabled />);
  const trigger = screen.getByRole("button", { name: "Отправить изменения" });
  expect(trigger.hasAttribute("disabled")).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
});
