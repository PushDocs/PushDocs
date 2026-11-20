"use client";

import { useSyncExternalStore } from "react";
import { EditorWordWrap, editorPreferences } from "../lib/editor-settings";

let memoryWordWrap: EditorWordWrap = editorPreferences.defaultWordWrap;
let unsavedWordWrap: EditorWordWrap | undefined;

function getWordWrap(): EditorWordWrap {
  if (unsavedWordWrap) return unsavedWordWrap;
  try {
    return localStorage.getItem(editorPreferences.storageKey) === EditorWordWrap.Off
      ? EditorWordWrap.Off
      : editorPreferences.defaultWordWrap;
  } catch {
    return memoryWordWrap;
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === editorPreferences.storageKey || event.key === null) {
      unsavedWordWrap = undefined;
      listener();
    }
  };
  window.addEventListener(editorPreferences.changeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(editorPreferences.changeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setWordWrap(wordWrap: EditorWordWrap) {
  memoryWordWrap = wordWrap;
  try {
    localStorage.setItem(editorPreferences.storageKey, wordWrap);
    unsavedWordWrap = undefined;
  } catch {
    unsavedWordWrap = wordWrap;
  }
  window.dispatchEvent(new Event(editorPreferences.changeEvent));
}

export function useEditorWordWrap() {
  const wordWrap = useSyncExternalStore(
    subscribe,
    getWordWrap,
    () => editorPreferences.defaultWordWrap,
  );
  return [wordWrap, setWordWrap] as const;
}
