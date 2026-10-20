import { parseProjectConfig } from "@pushdocs/content/config";
import { useRef, useState } from "react";
import { SourceEditor, type SourceEditorHandle } from "../../apps/web/src/components/source-editor";
import sendsayExample from "../../docs/examples/sendsay-docs.pushdocs.json";

const repositoryPaths = [
  "docs/guide.mdx",
  "docs/images/local.png",
  "docs/images/a file.png",
  "static/img/static-only/labels/one.png",
  "static/img/static-only/a file.png",
  "staticLocalized/ru/video/forms/clips/demo.mp4",
  "staticLocalized/ru/img/account-settings/labels/one.png",
  "staticLocalized/ru/img/account-settings/labels/two.png",
  "staticLocalized/ru/img/account-settings/how-to-enable-2fa/screen.png",
];

export function PathCompletionsFixture() {
  const [text, setText] = useState("");
  const inputRef = useRef<SourceEditorHandle>(null);
  return (
    <main
      className="workbench"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
    >
      <SourceEditor
        media={parseProjectConfig(JSON.stringify(sendsayExample)).media}
        path="docs/guide.mdx"
        repositoryPaths={repositoryPaths}
        inputRef={inputRef}
        value={text}
        readOnly={false}
        onChange={setText}
        onSave={() => {}}
        onIndent={() => {}}
      />
    </main>
  );
}
