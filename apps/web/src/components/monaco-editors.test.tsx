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
  const listeners = Array.from({ length: 3 }, () => ({ dispose: vi.fn() }));
  const model = {
    getValue: () => text,
    getFullModelRange: () => "full",
    getValueInRange: () => "selected",
    getLineCount: () => 30,
    dispose: vi.fn(),
  };
  const editor = {
    onDidChangeModelContent: vi.fn((callback) => {
      change = callback;
      return listeners[0];
    }),
    onDidChangeCursorSelection: vi.fn(() => listeners[1]),
    onDidScrollChange: vi.fn(() => listeners[2]),
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
  };
  return {
    api: api as unknown as MonacoApi,
    editor,
    model,
    listeners,
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
