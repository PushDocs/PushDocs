import { useEffect, useRef, useState } from "react";
import {
  CollaborationError,
  CollaborativeDocument,
} from "../../apps/web/src/components/collaborative-document";
import { SourceEditor, type SourceEditorHandle } from "../../apps/web/src/components/source-editor";

export function CollaborationFixture() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Подключаемся…");
  const [ready, setReady] = useState(false);
  const handle = useRef<SourceEditorHandle | null>(null);
  const session = useRef<CollaborativeDocument | null>(null);
  useEffect(() => {
    const value = new CollaborativeDocument({
      key: "ui:collaboration",
      storage: sessionStorage,
      exchange: async (input) => {
        const response = await fetch("/collaboration", {
          method: "POST",
          body: JSON.stringify(input),
        });
        const reply = await response.json();
        if (!response.ok) throw new CollaborationError(reply.error, response.status);
        return reply;
      },
      onText: (value, pending) => {
        setText(value);
        if (pending) setStatus("Есть изменения");
      },
      onSaved: (_reply, pending) => {
        setReady(true);
        setStatus(pending ? "Есть изменения" : "Сохранено");
      },
      onError: () => setStatus("Нет связи"),
    });
    session.current = value;
    if (value.isReady) {
      setReady(true);
      setText(value.text);
    }
    void value.sync();
    const timer = setInterval(() => void value.sync(), 200);
    return () => {
      clearInterval(timer);
      session.current = null;
      value.stop();
    };
  }, []);
  return (
    <main style={{ padding: 24 }}>
      <p role="status">{status}</p>
      <div className="wb-document-body" style={{ height: 400 }}>
        <SourceEditor
          path="docs/a.md"
          storageKey="collaboration-editor"
          value={text}
          readOnly={!ready}
          inputRef={handle}
          onChange={(value) => session.current?.edit(value)}
          onSave={() => void session.current?.sync()}
          onIndent={() => {}}
          onUndo={() => session.current?.undo()}
          onRedo={() => session.current?.redo()}
        />
      </div>
    </main>
  );
}
