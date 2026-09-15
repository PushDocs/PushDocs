// @vitest-environment jsdom
import type { ChangeRequestDetails } from "@pushdocs/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReviewInformation, ReviewReadiness } from "./review-information";

afterEach(cleanup);
const details: ChangeRequestDetails = {
  headSha: "sha",
  readiness: { state: "blocked", reason: "not_approved" },
  labels: [
    { name: "docs", color: "#abcdef" },
    { name: "untrusted", color: "url(example.test)" },
  ],
  approvals: {
    required: 2,
    remaining: 1,
    reviewers: [
      { name: "Anna", state: "approved" },
      { name: "Bob", state: "changes_requested" },
    ],
  },
  comments: [
    {
      id: "note",
      author: "Anna",
      body: "<img src=x onerror=alert(1)>\nPlease fix",
      createdAt: "2026-09-15T09:00:00Z",
    },
  ],
  commentsComplete: true,
};

it("displays merge blockers, colored labels, approval requirements and plain read-only comments", () => {
  const { container } = render(<ReviewInformation details={details} />);
  expect(screen.getByText("Не готов к слиянию")).toBeTruthy();
  expect(screen.getByText("Не хватает обязательных одобрений.")).toBeTruthy();
  expect(screen.getByText("Получено: 1 · Требуется: 2 · Осталось: 1")).toBeTruthy();
  expect(screen.getByText("Запрошены изменения")).toBeTruthy();
  const labels = within(screen.getByRole("region", { name: "Лейблы" }));
  expect(labels.getByText("docs").querySelector("i")?.style.backgroundColor).toBe(
    "rgb(171, 205, 239)",
  );
  expect(labels.getByText("untrusted").querySelector("i")?.style.backgroundColor).toBe("");
  expect(screen.getByText(/<img src=x/).textContent).toContain("\nPlease fix");
  expect(
    container.querySelectorAll("img, form, textarea, input, button, a, [contenteditable]"),
  ).toHaveLength(0);
  expect(screen.getByRole("region", { name: "Комментарии" }).querySelectorAll("li")).toHaveLength(
    1,
  );
});

it("distinguishes unavailable details from known empty labels, approvals and comments", () => {
  const view = render(<ReviewInformation details={null} />);
  expect(screen.getByText("Готовность неизвестна")).toBeTruthy();
  expect(screen.getByText("Комментарии недоступны.")).toBeTruthy();
  expect(screen.getByText("Одобрения недоступны.")).toBeTruthy();
  expect(screen.getByText("Лейблы недоступны.")).toBeTruthy();
  view.rerender(
    <ReviewInformation
      details={{
        ...details,
        readiness: { state: "ready", reason: null },
        labels: [],
        approvals: { required: null, remaining: null, reviewers: [] },
        comments: [],
      }}
    />,
  );
  expect(screen.getByText("Готов к слиянию")).toBeTruthy();
  expect(screen.getByText("Нет комментариев.")).toBeTruthy();
  expect(screen.getByText("Нет лейблов.")).toBeTruthy();
  expect(screen.getByText("Пока нет одобрений.")).toBeTruthy();
  expect(screen.queryByText(/Требуется:/)).toBeNull();
});

it("shows accessible comments with an incomplete notice and translates unknown blockers without exposing technical codes", () => {
  render(
    <ReviewInformation
      details={{
        ...details,
        commentsComplete: false,
        readiness: { state: "blocked", reason: "future_provider_code" },
      }}
    />,
  );
  expect(screen.getByText("Часть комментариев недоступна.")).toBeTruthy();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
  expect(
    screen.getByText("Git-провайдер сообщает, что условия слияния ещё не выполнены."),
  ).toBeTruthy();
  expect(screen.queryByText("future_provider_code")).toBeNull();
});

it("shows a checking status independently of CI check results", () => {
  render(
    <ReviewReadiness
      details={{ ...details, readiness: { state: "checking", reason: "checking" } }}
    />,
  );
  expect(screen.getByText("Готовность проверяется")).toBeTruthy();
});
