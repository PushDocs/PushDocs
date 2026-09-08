import { expect, it } from "vitest";
import { applyEditorInput } from "./editing";

it("preserves untouched CRLF bytes, JSX and entities when browser input normalizes newlines", () => {
  const source =
    "---\r\ntitle: Guide\r\n---\r\n\r\nimport X from './x';\r\n\r\n# Original\r\n<X value={1} />\r\n&#x20;\nTail\r\n";
  const displayed = source.replace(/\r\n/g, "\n");
  expect(applyEditorInput(source, displayed)).toBe(source);
  expect(applyEditorInput(source, displayed.replace("Original", "Changed"))).toBe(
    source.replace("Original", "Changed"),
  );
  expect(applyEditorInput(source, displayed.replace("Original", "Changed\n\nNew paragraph"))).toBe(
    source.replace("Original", "Changed\r\n\r\nNew paragraph"),
  );
});
