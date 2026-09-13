// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MonacoDiff } from "./monaco-diff";
import { editorOptions, fileLanguage, type MonacoApi } from "./monaco-runtime";
import { MonacoSourceEditor, type SourceEditorHandle } from "./source-editor";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function runtime() {
  let text = "";
  let change = () => {};
  let select = () => {};
  let scroll = () => {};
  const listeners = Array.from({ length: 3 }, () => ({ dispose: vi.fn() }));
  const model = {
    getValue: () => text,
    getFullModelRange: () => "full",
    getValueInRange: () => "selected",
    getLineCount: () => 30,
    getOffsetAt: vi.fn((position) => position.offset ?? 4),
    getPositionAt: vi.fn((offset) => ({ lineNumber: 1, column: offset + 1 })),
    dispose: vi.fn(),
  };
  const editor = {
    onDidChangeModelContent: vi.fn((callback) => {
      change = callback;
      return listeners[0];
    }),
    onDidChangeCursorSelection: vi.fn((callback: () => void) => {
      select = callback;
      return listeners[1];
    }),
    onDidScrollChange: vi.fn((callback: () => void) => {
      scroll = callback;
      return listeners[2];
    }),
    addCommand: vi.fn(),
    getSelection: () => "selection",
    getModel: () => model,
    executeEdits: vi.fn((_source, edits) => {
      text = edits[0].text;
      change();
    }),
    pushUndoStop: vi.fn(),
    focus: vi.fn(),
    saveViewState: vi.fn(() => ({ cursorState: ["position"], viewState: { scrollTop: 96 } })),
    restoreViewState: vi.fn(),
    updateOptions: vi.fn(),
    setSelection: vi.fn(),
    setScrollPosition: vi.fn(),
    setPosition: vi.fn(),
    revealLineInCenter: vi.fn(),
    setModel: vi.fn(),
    dispose: vi.fn(),
  };
  const api = {
    editor: {
      createModel: vi.fn((value) => {
        text = value;
        return model;
      }),
      create: vi.fn(() => editor),
      createDiffEditor: vi.fn(() => editor),
    },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49 },
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
  };
  return {
    api: api as unknown as MonacoApi,
    editor,
    model,
    listeners,
    select: () => select(),
    scroll: () => scroll(),
    type: (value: string) => {
      text = value;
      change();
    },
  };
}

it("uses faint indentation guides and chooses the actual file language", () => {
  expect(editorOptions.guides).toEqual({
    indentation: true,
    highlightActiveIndentation: true,
    bracketPairs: false,
  });
  expect(fileLanguage("docs/a.mdx")).toBe("mdx");
  expect(fileLanguage("_category_.json")).toBe("json");
  expect(fileLanguage("config.yaml")).toBe("yaml");
  expect(fileLanguage("LICENSE")).toBe("plaintext");
});

it("keeps CRLF bytes, never saves on mount, and applies external replacements without echoing edits", () => {
  const rt = runtime();
  const onChange = vi.fn();
  const onSave = vi.fn();
  const props = {
    monaco: rt.api,
    value: "one\r\ntwo\r\n",
    path: "a.mdx",
    readOnly: false,
    onChange,
    onSave,
    onIndent: vi.fn(),
    inputRef: createRef<SourceEditorHandle>(),
  };
  const view = render(<MonacoSourceEditor {...props} />);
  expect(onChange).not.toHaveBeenCalled();
  act(() => rt.type("one\nupdated\n"));
  expect(onChange).toHaveBeenLastCalledWith("one\r\nupdated\r\n");
  view.rerender(<MonacoSourceEditor {...props} value={"replacement\r\n"} />);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(rt.editor.executeEdits).toHaveBeenLastCalledWith("external", [
    { range: "full", text: "replacement\n" },
  ]);
  expect(rt.editor.pushUndoStop).toHaveBeenCalledTimes(2);
  act(() => rt.editor.addCommand.mock.calls[0]?.[1]());
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("inserts components as undoable edits, honors permission changes and restores file position", () => {
  const rt = runtime();
  const ref = createRef<SourceEditorHandle>();
  const props = {
    monaco: rt.api,
    value: "text",
    storageKey: "file-a",
    readOnly: false,
    onChange: vi.fn(),
    onSave: vi.fn(),
    onIndent: vi.fn(),
    inputRef: ref,
  };
  sessionStorage.setItem("file-a:monaco", JSON.stringify({ cursorState: ["saved"] }));
  const view = render(<MonacoSourceEditor {...props} jump={{ line: 99, token: 1 }} />);
  expect(rt.editor.restoreViewState).toHaveBeenCalledWith({ cursorState: ["saved"] });
  expect(rt.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 30, column: 1 });
  act(() => ref.current?.replaceSelection?.("<Tip>", "</Tip>"));
  expect(rt.editor.executeEdits).toHaveBeenCalledWith("toolbar", [
    { range: "selection", text: "<Tip>selected</Tip>", forceMoveMarkers: true },
  ]);
  view.rerender(<MonacoSourceEditor {...props} readOnly />);
  expect(rt.editor.updateOptions).toHaveBeenLastCalledWith({ readOnly: true });
  const count = rt.editor.executeEdits.mock.calls.length;
  act(() => ref.current?.replaceSelection?.("blocked"));
  expect(rt.editor.executeEdits).toHaveBeenCalledTimes(count);
  view.unmount();
  expect(ref.current).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("file-a:monaco") ?? "null").viewState.scrollTop).toBe(
    96,
  );
  expect(rt.model.dispose).toHaveBeenCalledOnce();
  expect(rt.editor.dispose).toHaveBeenCalledOnce();
  for (const listener of rt.listeners) expect(listener.dispose).toHaveBeenCalledOnce();
});

it("exposes selection handles and restores the legacy textarea position", () => {
  const rt = runtime();
  rt.editor.getSelection = (() => ({
    getStartPosition: () => ({ offset: 2 }),
    getEndPosition: () => ({ offset: 5 }),
  })) as never;
  const ref = createRef<SourceEditorHandle>();
  sessionStorage.setItem("legacy", JSON.stringify({ start: 2, end: 5, top: 40, left: 12 }));
  render(
    <MonacoSourceEditor
      monaco={rt.api}
      value="text"
      storageKey="legacy"
      readOnly={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={vi.fn()}
      inputRef={ref}
    />,
  );
  expect(ref.current?.selectionStart).toBe(2);
  expect(ref.current?.selectionEnd).toBe(5);
  ref.current?.focus();
  ref.current?.setSelectionRange(1, 3);
  expect(rt.editor.focus).toHaveBeenCalled();
  expect(rt.editor.setSelection).toHaveBeenCalled();
  expect(rt.editor.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 40, scrollLeft: 12 });
});

it("handles empty selections and remembers nothing without a storage key", () => {
  const rt = runtime();
  rt.editor.getSelection = vi.fn(() => null) as never;
  const ref = createRef<SourceEditorHandle>();
  render(
    <MonacoSourceEditor
      monaco={rt.api}
      value="text"
      readOnly={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={vi.fn()}
      inputRef={ref}
    />,
  );

  expect(ref.current?.selectionStart).toBe(0);
  expect(ref.current?.selectionEnd).toBe(0);
  ref.current?.replaceSelection?.("blocked");
  expect(rt.editor.executeEdits).not.toHaveBeenCalled();

  act(() => rt.select());
  act(() => rt.scroll());

  rt.editor.getSelection = vi.fn(() => "selection");
  rt.model.getValueInRange = vi.fn(() => "");
  ref.current?.replaceSelection?.("<Tip>", "</Tip>");
  expect(rt.editor.executeEdits).toHaveBeenLastCalledWith("toolbar", [
    { range: "selection", text: "<Tip>текст</Tip>", forceMoveMarkers: true },
  ]);
  ref.current?.replaceSelection?.("plain");
  expect(rt.editor.executeEdits).toHaveBeenLastCalledWith("toolbar", [
    { range: "selection", text: "plain", forceMoveMarkers: true },
  ]);
});

it("uses legacy position defaults and leaves a replaced external ref alone", () => {
  const rt = runtime();
  rt.editor.getModel = vi.fn(() => null) as never;
  const ref = createRef<SourceEditorHandle>();
  sessionStorage.setItem("legacy-defaults", JSON.stringify({}));
  const view = render(
    <MonacoSourceEditor
      monaco={rt.api}
      value="text"
      storageKey="legacy-defaults"
      readOnly={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={vi.fn()}
      inputRef={ref}
      jump={{ line: 12, token: 1 }}
    />,
  );

  expect(rt.editor.setSelection).toHaveBeenCalledWith(new rt.api.Range(1, 1, 1, 1));
  expect(rt.editor.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 0, scrollLeft: 0 });
  expect(rt.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 });

  const replacement = {
    selectionStart: 0,
    selectionEnd: 0,
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  ref.current = replacement;
  view.unmount();
  expect(ref.current).toBe(replacement);
});

it("starts cleanly when a file has no stored Monaco or legacy position", () => {
  const rt = runtime();
  render(
    <MonacoSourceEditor
      monaco={rt.api}
      value="text"
      storageKey="missing-position"
      readOnly={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onIndent={vi.fn()}
      inputRef={createRef<SourceEditorHandle>()}
    />,
  );
  expect(rt.editor.restoreViewState).not.toHaveBeenCalled();
  expect(rt.editor.setSelection).not.toHaveBeenCalled();
});

it("keeps both diff sides read-only, includes whitespace changes and releases old models", () => {
  const rt = runtime();
  const view = render(
    <MonacoDiff
      monaco={rt.api}
      before="a"
      after=" b"
      path="config.json"
      split={false}
      showAll={false}
    />,
  );
  expect(rt.api.editor.createModel).toHaveBeenNthCalledWith(1, "a", "json");
  expect(rt.api.editor.createDiffEditor).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({
      readOnly: true,
      originalEditable: false,
      ignoreTrimWhitespace: false,
    }),
  );
  view.rerender(
    <MonacoDiff monaco={rt.api} before="a" after=" b" path="config.json" split showAll />,
  );
  expect(rt.editor.updateOptions).toHaveBeenLastCalledWith({
    renderSideBySide: true,
    hideUnchangedRegions: { enabled: false, contextLineCount: 3 },
  });
  expect(rt.api.editor.createDiffEditor).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(rt.model.dispose).toHaveBeenCalledTimes(2);
  expect(rt.editor.dispose).toHaveBeenCalledOnce();
});
