import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(require.resolve("monaco-editor")), "../..");
const { version } = require(path.join(root, "package.json"));
const output = path.resolve("public/monaco", version);
await mkdir(output, { recursive: true });
const options = {
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  loader: { ".ttf": "file" },
  logLevel: "warning",
};
await build({
  ...options,
  stdin: {
    contents: 'import "monaco-editor/nls/lang/ru.js"; export * from "monaco-editor";',
    resolveDir: process.cwd(),
  },
  globalName: "PushDocsMonaco",
  outfile: path.join(output, "editor.js"),
});
for (const [name, entry] of Object.entries({
  editor: "editor/editor.worker.js",
  json: "language/json/json.worker.js",
  css: "language/css/css.worker.js",
  html: "language/html/html.worker.js",
  ts: "language/typescript/ts.worker.js",
})) {
  await build({
    ...options,
    entryPoints: [path.join(root, "esm/vs", entry)],
    outfile: path.join(output, `${name}.worker.js`),
  });
}
await writeFile(path.resolve("public/monaco/version.json"), JSON.stringify({ version }));
