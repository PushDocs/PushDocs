import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import * as Y from "yjs";

export async function startFixtureServer() {
  const result = await build({
    entryPoints: ["tests/ui/fixture.tsx"],
    bundle: true,
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const shared = new Y.Doc();
  shared.getText("source").insert(0, "abc");
  const server = createServer(async (request, response) => {
    if (request.url === "/collaboration") {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (input.update) Y.applyUpdate(shared, Buffer.from(input.update, "base64"));
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          epoch: "ui-epoch",
          revision: 1,
          content: shared.getText("source").toString(),
          update: Buffer.from(
            Y.encodeStateAsUpdate(
              shared,
              input.vector ? Buffer.from(input.vector, "base64") : undefined,
            ),
          ).toString("base64"),
          vector: Buffer.from(Y.encodeStateVector(shared)).toString("base64"),
        }),
      );
      return;
    }
    if (/^\/monaco\/0\.56\.0\/[\w.-]+$/.test(request.url ?? "")) {
      try {
        const asset = await readFile(`apps/web/public${request.url}`);
        response.setHeader(
          "Content-Type",
          request.url?.endsWith(".css")
            ? "text/css"
            : request.url?.endsWith(".ttf")
              ? "font/ttf"
              : "text/javascript",
        );
        response.end(asset);
      } catch {
        response.writeHead(404).end();
      }
      return;
    }
    const script = request.url === "/fixture.js";
    response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
    response.end(
      script
        ? js
        : `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not start");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          shared.destroy();
          if (error) reject(error);
          else resolve();
        }),
      ),
  };
}
