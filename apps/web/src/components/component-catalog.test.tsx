// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/actions", () => ({ createProjectComponentAction: mocks.save }));

import { ComponentCatalog } from "./component-catalog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.save.mockReset();
});
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
const editableProps = { ...props, templateEditingEnabled: true };

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
  expect(screen.queryByRole("button", { name: "Изменить шаблон вставки" })).toBeNull();
  expect(screen.queryByText("Добавить шаблон вставки")).toBeNull();
});
it("hides component configuration from readers", () => {
  render(<ComponentCatalog {...props} canEdit={false} />);
  expect(screen.queryByText("Добавить шаблон вставки")).toBeNull();
});

it("shows where the template is used, previews edits and saves the template fields", async () => {
  mocks.save.mockResolvedValue(undefined);
  const { container } = render(<ComponentCatalog {...editableProps} />);
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

it("copies insertion code, reports clipboard errors and closes the editor", async () => {
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { container } = render(<ComponentCatalog {...editableProps} />);
  const card = container.querySelector(".component-card") as HTMLDetailsElement;
  card.open = true;
  fireEvent(card, new Event("toggle"));
  fireEvent.click(await screen.findByRole("button", { name: "Копировать" }));
  expect(await screen.findByRole("button", { name: "Скопировано" })).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(props.examples.RecentlyUpdatedArticlesIframe.snippet);
  fireEvent.click(screen.getByRole("button", { name: "Скопировано" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Изменить шаблон вставки" }));
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.getByRole("heading", { name: "Пример вставки" })).toBeTruthy();
});

it("closes a new template form and reports save failures", async () => {
  mocks.save.mockRejectedValue(new Error("offline"));
  const { container } = render(<ComponentCatalog {...editableProps} />);
  const add = container.querySelector(".component-add") as HTMLDetailsElement;
  add.open = true;
  fireEvent(add, new Event("toggle"));
  const form = await screen.findByRole("button", { name: "Сохранить шаблон" });
  fireEvent.change(screen.getByLabelText("Название в меню"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Код для вставки в статью"), {
    target: { value: "<SupportLink />" },
  });
  fireEvent.submit(form.closest("form") as HTMLFormElement);
  expect((await screen.findByRole("alert")).textContent).toContain("Не удалось сохранить");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.queryByLabelText("Код для вставки в статью")).toBeNull();
});
