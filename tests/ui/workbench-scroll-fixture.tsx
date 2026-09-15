import { useRef, useState } from "react";
import { DocumentTabs } from "../../apps/web/src/components/document-tabs";
import { FileExplorer } from "../../apps/web/src/components/file-explorer";
import { SourceEditor, type SourceEditorHandle } from "../../apps/web/src/components/source-editor";

const paths = Array.from(
  { length: 500 },
  (_, index) => `file-${String(index).padStart(3, "0")}.md`,
);
const initialText = Array.from({ length: 300 }, (_, index) => `Строка ${index + 1}`).join("\n");

export function WorkbenchScrollFixture() {
  const files = new URLSearchParams(window.location.search).has("small")
    ? paths.slice(0, 80)
    : paths;
  const [selected, setSelected] = useState(paths[0] ?? "");
  const [text, setText] = useState(initialText);
  const [split, setSplit] = useState(false);
  const inputRef = useRef<SourceEditorHandle>(null);
  return (
    <div className="app-frame">
      <aside className="app-sidebar">PushDocs</aside>
      <main className="app-main">
        <div className="workbench">
          <header className="wb-header">
            <h1>Документы</h1>
          </header>
          <div className="wb-layout">
            <aside className="wb-tree">
              <button className="wb-quick-open" type="button">
                Найти файл
              </button>
              <FileExplorer
                paths={files}
                selected={selected}
                statuses={new Map()}
                readOnly={false}
                busy={false}
                onOpen={setSelected}
                onCreate={() => {}}
              />
            </aside>
            <hr className="wb-resizer" />
            <section className="wb-editor">
              <div className="wb-document">
                <DocumentTabs
                  tabs={paths.slice(0, 2)}
                  selected={selected}
                  statuses={new Map()}
                  onOpen={setSelected}
                  onClose={() => {}}
                  onReorder={() => {}}
                />
                <div className="wb-filebar">{selected}</div>
                <div className="wb-toolbar">
                  <button type="button" onClick={() => setSplit(false)}>
                    Файл
                  </button>
                  <button type="button" onClick={() => setSplit(true)}>
                    Две панели
                  </button>
                </div>
                <div className={`wb-document-body${split ? " wb-split-view" : ""}`}>
                  <SourceEditor
                    key={selected}
                    path={selected}
                    storageKey={`fixture:${selected}`}
                    inputRef={inputRef}
                    value={text}
                    readOnly={false}
                    onChange={setText}
                    onSave={() => {}}
                    onIndent={() => {}}
                  />
                  {split ? (
                    <div className="wb-markdown">
                      <pre>{initialText}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
