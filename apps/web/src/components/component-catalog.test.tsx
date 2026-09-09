// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/actions", () => ({ createProjectComponentAction: mocks.save }));

import { ComponentCatalog } from "./component-catalog";

afterEach(cleanup);
const props = {
  projectId: "project",
  branch: "stable",
  repositoryPaths: [],
  canEdit: true,
  components: [
    {
      id: "1",
      name: "RecentlyUpdatedArticlesIframe",
      label: "RecentlyUpdatedArticlesIframe",
      description: "Найден при импорте MDX. Настройте шаблон перед использованием.",
      snippet: "<RecentlyUpdatedArticlesIframe />",
      source: "detected",
    },
  ],
  examples: {
    RecentlyUpdatedArticlesIframe: {
      snippet: "<SupportLink>Написать нам</SupportLink>",
      path: "docs/a.mdx",
    },
  },
};
it("shows a name once and reveals actual insertion code and preview on expansion", async () => {
  const { container } = render(<ComponentCatalog {...props} />);
  expect(screen.getAllByText("RecentlyUpdatedArticlesIframe")).toHaveLength(1);
  expect(container.textContent).not.toContain("Найден");
  const card = container.querySelector(".component-card") as HTMLDetailsElement;
  card.open = true;
  fireEvent(card, new Event("toggle"));
  expect(await screen.findByRole("heading", { name: "Пример вставки" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Превью" })).toBeTruthy();
  expect(screen.getByText("Написать нам")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Изменить шаблон вставки" }));
  expect((screen.getByLabelText("Код для вставки в статью") as HTMLTextAreaElement).value).toBe(
    props.examples.RecentlyUpdatedArticlesIframe.snippet,
  );
});
it("hides component configuration from readers", () => {
  render(<ComponentCatalog {...props} canEdit={false} />);
  expect(screen.queryByText("Добавить шаблон вставки")).toBeNull();
});

it("shows where the template is used, previews edits and saves the template fields", async () => {
  mocks.save.mockResolvedValue(undefined);
  const { container } = render(<ComponentCatalog {...props} />);
  const add = container.querySelector(".component-add") as HTMLDetailsElement;
  add.open = true;
  fireEvent(add, new Event("toggle"));
  const label = await screen.findByLabelText("Название в меню");
  fireEvent.change(label, { target: { value: "Помощь" } });
  fireEvent.change(screen.getByLabelText("Код для вставки в статью"), {
    target: { value: "<SupportLink>Связаться с нами</SupportLink>" },
  });
  expect(screen.getByText("Помощь").parentElement?.textContent).toBe("РедакторКомпонентПомощь");
  expect(screen.getByText("Связаться с нами")).toBeTruthy();
  expect(screen.queryByText("Сохранить компонент")).toBeNull();
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  expect(await screen.findByRole("status")).toBeTruthy();
  const fields = Object.fromEntries(mocks.save.mock.calls[0]?.[0] ?? []);
  expect(fields).toMatchObject({
    projectId: "project",
    name: "SupportLink",
    label: "Помощь",
    snippet: "<SupportLink>Связаться с нами</SupportLink>",
  });
  expect(screen.getByRole("link", { name: "Открыть редактор" }).getAttribute("href")).toBe(
    "/projects/project/documents?branch=stable",
  );
});
