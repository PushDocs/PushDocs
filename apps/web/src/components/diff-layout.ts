"use client";

import { useSyncExternalStore } from "react";

type DiffLayout = "unified" | "split";
const storageKey = "pushdocs:diff-layout";
const changeEvent = "pushdocs:diff-layout-change";
let memoryLayout: DiffLayout = "unified";
let unsavedLayout: DiffLayout | undefined;

function getLayout(): DiffLayout {
  if (unsavedLayout) return unsavedLayout;
  try {
    return localStorage.getItem(storageKey) === "split" ? "split" : "unified";
  } catch {
    return memoryLayout;
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      unsavedLayout = undefined;
      listener();
    }
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setLayout(layout: DiffLayout) {
  memoryLayout = layout;
  try {
    localStorage.setItem(storageKey, layout);
    unsavedLayout = undefined;
  } catch {
    // Keep the shared choice for this page when browser storage is unavailable.
    unsavedLayout = layout;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useDiffLayout() {
  const layout = useSyncExternalStore(subscribe, getLayout, () => "unified" as const);
  return [layout, setLayout] as const;
}
