// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveDraftAction: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@pushdocs/ui", () => ({
  Button: ({
    tone: _tone,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }) => <button {...props} />,
  Select: ({
    label,
    onValueChange,
    options,
    value,
  }: {
    label: string;
    onValueChange?: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <select
      aria-label={label}
      onChange={(event) => onValueChange?.(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/app/actions", () => ({ saveDraftAction: mocks.saveDraftAction }));

import { DocumentEditor } from "./document-editor";

const defaultProps = {
  baseCommitSha: "abcdef0",
  branch: "docs/update",
  components: [
    { label: "Warning", name: "Docs.Warning", snippet: "<Docs.Warning />" },
    { label: "Hint", name: "Docs.Hint", snippet: "<Docs.Hint />" },
  ],
  initialContent: "# Initial",
  initialRevision: 3,
  path: "docs/a.mdx",
  projectId: "project",
  readOnly: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.saveDraftAction.mockResolvedValue({ revision: 4 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function runAutosave(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(1200);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DocumentEditor modes and formatting", () => {
  it("switches between editor, source, and preview", () => {
    render(<DocumentEditor {...defaultProps} />);
    const editor = screen.getByRole("textbox", { name: "Текст документа" });
    expect((editor as HTMLTextAreaElement).spellcheck).not.toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "MDX" }));
    expect(screen.getByRole("textbox", { name: "Исходник MDX" }).className).toBe("source-editor");
    fireEvent.click(screen.getByRole("tab", { name: "Предпросмотр" }));
    expect(screen.getByRole("heading", { name: "Initial" })).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Форматирование" })).toBeNull();
  });

  it("replaces custom component tags in the preview", () => {
    render(<DocumentEditor {...defaultProps} initialContent="# Page\n\n<Docs.Warning />" />);
    fireEvent.click(screen.getByRole("tab", { name: "Предпросмотр" }));
    expect(screen.getByText(/Компонент/).textContent).toContain("Docs.Warning");
  });

  it("appends formatting snippets and selected components", () => {
    render(<DocumentEditor {...defaultProps} initialContent="Text" />);
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Заголовок" }));
    expect(editor.value).toContain("## Новый раздел");
    fireEvent.click(screen.getByRole("button", { name: "Жирный" }));
    expect(editor.value).toContain("**важный текст**");
    fireEvent.click(screen.getByRole("button", { name: "Курсив" }));
    fireEvent.click(screen.getByRole("button", { name: "Ссылка" }));
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(editor.value).toContain("_текст_");
    expect(editor.value).toContain("[ссылка](https://example.test)");
    expect(editor.value).toContain("- пункт");
    fireEvent.change(screen.getByRole("combobox", { name: "Компонент MDX" }), {
      target: { value: "<Docs.Hint />" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Вставить" }));
    expect(editor.value).toContain("<Docs.Hint />");
  });

  it("shows the empty component state", () => {
    render(<DocumentEditor {...defaultProps} components={[]} />);
    expect(screen.getByRole("button", { name: "Нет компонентов" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("does not modify a read-only document", () => {
    render(<DocumentEditor {...defaultProps} readOnly />);
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Заголовок" }));
    expect(editor.value).toBe("# Initial");
    expect(screen.getByRole("button", { name: "Вставить" })).toHaveProperty("disabled", true);
  });
});

describe("DocumentEditor autosave", () => {
  it("saves changed content with the current revision", async () => {
    render(<DocumentEditor {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Changed" } });
    expect(screen.getByText("Есть изменения")).toBeTruthy();
    await runAutosave();
    expect(mocks.saveDraftAction).toHaveBeenCalledOnce();
    const payload = mocks.saveDraftAction.mock.calls[0]?.[0] as FormData;
    expect(Object.fromEntries(payload)).toEqual({
      baseCommitSha: "abcdef0",
      branch: "docs/update",
      content: "# Changed",
      expectedRevision: "3",
      path: "docs/a.mdx",
      projectId: "project",
    });
    expect(screen.getByText("Сохранено в PushDocs")).toBeTruthy();
  });

  it("uses the returned revision for the next save", async () => {
    mocks.saveDraftAction
      .mockResolvedValueOnce({ revision: 9 })
      .mockResolvedValueOnce({ revision: 10 });
    render(<DocumentEditor {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "First" } });
    await runAutosave();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second" } });
    await runAutosave();
    const secondPayload = mocks.saveDraftAction.mock.calls[1]?.[0] as FormData | undefined;
    expect(secondPayload?.get("expectedRevision")).toBe("9");
  });

  it("uses the next local revision when the action omits it", async () => {
    mocks.saveDraftAction.mockResolvedValueOnce({});
    render(<DocumentEditor {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "First" } });
    await runAutosave();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second" } });
    await runAutosave();
    const secondPayload = mocks.saveDraftAction.mock.calls[1]?.[0] as FormData | undefined;
    expect(secondPayload?.get("expectedRevision")).toBe("4");
  });

  it("shows a conflict and stops later autosaves", async () => {
    mocks.saveDraftAction.mockResolvedValueOnce({ error: "conflict" });
    render(<DocumentEditor {...defaultProps} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Conflicting" } });
    await runAutosave();
    expect(screen.getByRole("alert").textContent).toContain("Документ изменился после открытия");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Later" } });
    await runAutosave();
    expect(mocks.saveDraftAction).toHaveBeenCalledOnce();
  });

  it("does not save unchanged or read-only content", async () => {
    const mounted = render(<DocumentEditor {...defaultProps} />);
    await runAutosave();
    expect(mocks.saveDraftAction).not.toHaveBeenCalled();
    mounted.rerender(<DocumentEditor {...defaultProps} readOnly />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ignored" } });
    await runAutosave();
    expect(mocks.saveDraftAction).not.toHaveBeenCalled();
  });
});
