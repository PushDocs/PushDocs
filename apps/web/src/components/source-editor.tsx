"use client";
import { applyEditorInput } from "@pushdocs/content/editing";
import type { editor } from "monaco-editor";
import { type RefObject, useEffect, useRef } from "react";
import { FallbackSourceEditor } from "./fallback-source-editor";
import { editorOptions, fileLanguage, type MonacoApi, useMonaco } from "./monaco-runtime";

export interface SourceEditorHandle {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  replaceSelection?: (value: string, wrap?: string) => void;
}
interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onIndent: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  readOnly: boolean;
  inputRef: RefObject<SourceEditorHandle | null>;
  storageKey?: string;
  path?: string;
  jump?: { line: number; token: number };
}

export function SourceEditor(props: SourceEditorProps) {
  const monaco = useMonaco();
  return monaco ? (
    <MonacoSourceEditor {...props} monaco={monaco} />
  ) : (
    <FallbackSourceEditor {...props} />
  );
}

export function MonacoSourceEditor(props: SourceEditorProps & { monaco: MonacoApi }) {
  const { monaco, storageKey, inputRef, path, value, readOnly, jump } = props;
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const current = useRef(props);
  current.current = props;
  useEffect(() => {
    /* v8 ignore next -- React attaches the host in the same commit before this effect. */
    if (!host.current) return;
    const model = monaco.editor.createModel(
      current.current.value.replace(/\r\n?/g, "\n"),
      fileLanguage(path),
    );
    const editor = monaco.editor.create(host.current, {
      ...editorOptions,
      model,
      readOnly: current.current.readOnly,
      ariaLabel: "Исходник документа",
    });
    instance.current = editor;
    let syncing = false;
    const change = editor.onDidChangeModelContent(() => {
      if (!syncing && !current.current.readOnly)
        current.current.onChange(applyEditorInput(current.current.value, model.getValue()));
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => current.current.onSave());
    const element = host.current;
    const historyKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !current.current.onUndo || current.current.readOnly)
        return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey || key === "y") current.current.onRedo?.();
      else current.current.onUndo();
    };
    element.addEventListener("keydown", historyKey, true);
    const handle: SourceEditorHandle = {
      get selectionStart() {
        const s = editor.getSelection();
        return s ? model.getOffsetAt(s.getStartPosition()) : 0;
      },
      get selectionEnd() {
        const s = editor.getSelection();
        return s ? model.getOffsetAt(s.getEndPosition()) : 0;
      },
      focus: () => editor.focus(),
      setSelectionRange: (start, end) => {
        const from = model.getPositionAt(start);
        const to = model.getPositionAt(end);
        editor.setSelection(
          new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
        );
      },
      replaceSelection: (value, wrap) => {
        const selection = editor.getSelection();
        if (!selection || current.current.readOnly) return;
        const text = wrap ? `${value}${model.getValueInRange(selection) || "текст"}${wrap}` : value;
        editor.pushUndoStop();
        editor.executeEdits("toolbar", [{ range: selection, text, forceMoveMarkers: true }]);
        editor.pushUndoStop();
        editor.focus();
      },
    };
    inputRef.current = handle;
    function remember() {
      if (!storageKey) return;
      try {
        sessionStorage.setItem(`${storageKey}:monaco`, JSON.stringify(editor.saveViewState()));
      } catch {}
    }
    if (storageKey) {
      try {
        const state = JSON.parse(sessionStorage.getItem(`${storageKey}:monaco`) ?? "null");
        if (state) editor.restoreViewState(state);
        else {
          const legacy = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
          if (legacy) {
            handle.setSelectionRange(legacy.start ?? 0, legacy.end ?? 0);
            editor.setScrollPosition({ scrollTop: legacy.top ?? 0, scrollLeft: legacy.left ?? 0 });
          }
        }
      } catch {}
    }
    const position = editor.onDidChangeCursorSelection(remember);
    const scroll = editor.onDidScrollChange(remember);
    // Parent updates are also undoable, including a confirmed replacement preview.
    const sync = (value: string) => {
      const text = value.replace(/\r\n?/g, "\n");
      if (model.getValue() === text) return;
      syncing = true;
      editor.pushUndoStop();
      if (current.current.onUndo) {
        const before = model.getValue();
        let start = 0;
        while (start < before.length && start < text.length && before[start] === text[start])
          start++;
        let end = 0;
        while (
          end < before.length - start &&
          end < text.length - start &&
          before[before.length - end - 1] === text[text.length - end - 1]
        )
          end++;
        const from = model.getPositionAt(start);
        const to = model.getPositionAt(before.length - end);
        editor.executeEdits("collaboration", [
          {
            range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
            text: text.slice(start, text.length - end),
            forceMoveMarkers: true,
          },
        ]);
      } else editor.executeEdits("external", [{ range: model.getFullModelRange(), text }]);
      editor.pushUndoStop();
      syncing = false;
    };
    syncValue.current = sync;
    return () => {
      remember();
      element.removeEventListener("keydown", historyKey, true);
      change.dispose();
      position.dispose();
      scroll.dispose();
      if (inputRef.current === handle) inputRef.current = null;
      syncValue.current = null;
      instance.current = null;
      editor.dispose();
      model.dispose();
    };
  }, [monaco, storageKey, path, inputRef]);
  const syncValue = useRef<((value: string) => void) | null>(null);
  useEffect(() => {
    syncValue.current?.(value);
  }, [value]);
  useEffect(() => {
    instance.current?.updateOptions({ readOnly });
  }, [readOnly]);
  useEffect(() => {
    if (!jump || !instance.current) return;
    const editor = instance.current;
    const lineNumber = Math.min(Math.max(1, jump.line), editor.getModel()?.getLineCount() ?? 1);
    editor.setPosition({ lineNumber, column: 1 });
    editor.revealLineInCenter(lineNumber);
    editor.focus();
  }, [jump]);
  return <div className="source-editor monaco-source" ref={host} data-testid="monaco-source" />;
}
