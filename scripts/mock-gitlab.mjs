// Local synthetic provider for repeatable UI smoke tests. No external writes.

import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("tests/fixtures/docusaurus");
const sha = "1234567890abcdef1234567890abcdef12345678";
const branches = [{ name: "main", commit: { id: sha } }];
async function files(dir = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (["node_modules", ".docusaurus", "build"].includes(entry.name)) continue;
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else result.push(file);
  }
  return result;
}
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;
    if (pathname.endsWith("/repository/tree")) {
      const rows = (await files()).map((file) => ({ path: file, type: "blob" }));
      const page = Number(url.searchParams.get("page") || 1);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(rows.slice((page - 1) * 100, page * 100)));
    } else if (pathname.endsWith("/repository/branches")) {
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body);
        const branch = { name: input.branch, commit: { id: input.ref } };
        branches.push(branch);
        response.end(JSON.stringify(branch));
      } else response.end(JSON.stringify(branches));
    } else if (pathname.includes("/repository/files/") && pathname.endsWith("/raw")) {
      const file = decodeURIComponent(pathname.split("/repository/files/")[1].slice(0, -4));
      if (!(await files()).includes(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.end(await readFile(path.join(root, file)));
    } else if (pathname.endsWith("/merge_requests")) response.end("[]");
    else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end();
  }
}).listen(4555, "127.0.0.1", () => console.log("Synthetic GitLab listening on 4555"));
