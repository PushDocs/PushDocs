export enum EditorWordWrap {
  On = "on",
  Off = "off",
}

export const editorPreferences = {
  storageKey: "pushdocs:editor-word-wrap",
  changeEvent: "pushdocs:editor-word-wrap-change",
  defaultWordWrap: EditorWordWrap.On,
} as const;
