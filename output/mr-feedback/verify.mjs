import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const result = await build({
  stdin: {
    contents: `
      import { createRoot } from "react-dom/client";
      import { SubmitChanges } from "./apps/web/src/components/submit-changes";
      import { GitOperation } from "./apps/web/src/components/git-operation";
      import "./packages/ui/src/styles.css";
      import "./apps/web/src/app/globals.css";
      const create = new URLSearchParams(location.search).has("create");
      createRoot(document.getElementById("root")).render(
        <main className="page changes-page">
          {create ? <section className="empty-state">
            <h2>Все изменения отправлены</h2>
            <GitOperation projectId="project" branch="docs/update" createReview reviewLabel="MR" />
          </section> : <>
            <h1>Изменения в ветке</h1>
            <SubmitChanges projectId="project" changeSetId="12345678-rest" branch="stable"
              defaultBranch="stable" reviewLabel="MR" disabled={false} submitting={false}
              action={async (data) => {
                const response = await fetch("/submit", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
                if (!response.ok) throw new Error("Submission failed");
              }} />
          </>}
        </main>
      );`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outfile: "fixture.js",
  jsx: "automatic",
  alias: {
    "@/app/actions": "./tests/ui/git-operation-actions.ts",
    "next/navigation": "./tests/ui/git-operation-navigation.ts",
  },
  define: { "process.env.NODE_ENV": '"development"' },
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`;
let submitted;
let created;
let submitReply;
let jobStatus = "running";
const server = createServer(async (request, response) => {
  if (request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === "/submit") {
      submitted = data;
      submitReply = () => response.writeHead(204).end();
    } else {
      created = data;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "review-job" }));
    }
    return;
  }
  if (request.url.startsWith("/fixture/git/status")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: jobStatus }));
    return;
  }
  response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/fixture.js" ? js : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const checks = [];
try {
  for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const description = "Тикет: https://tracker.test/DOC-123\nКомментарий к изменениям";
    submitted = undefined;
    await page.goto(base);
    await page.getByRole("button", { name: "Отправить изменения" }).click();
    const dialog = page.getByRole("dialog", { name: "Отправить изменения" });
    await page.getByRole("textbox", { name: "Название MR и сообщение коммита" }).fill("Update documentation");
    await page.getByRole("textbox", { name: "Описание MR (необязательно)" }).fill(description);
    assert.equal(await page.getByRole("textbox", { name: "Название MR и сообщение коммита" }).evaluate((element) => element.tagName), "INPUT");
    const titleHeight = (await page.getByRole("textbox", { name: "Название MR и сообщение коммита" }).boundingBox()).height;
    const descriptionHeight = (await page.getByRole("textbox", { name: "Описание MR (необязательно)" }).boundingBox()).height;
    assert(descriptionHeight >= 140 && descriptionHeight > titleHeight);
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: `output/mr-feedback/${name}-submission.png` });
    await page.getByRole("button", { name: "Отправить и создать MR" }).click();
    await expect.poll(() => submitted?.description).toBe(description);
    assert.equal(submitted.message, "Update documentation");
    assert.equal(submitted.newBranch, "docs/update-12345678");
    await expect(page.getByRole("button", { name: "Отправляем изменения…" })).toBeDisabled();
    submitReply();
    await expect(page.getByRole("button", { name: "Отправить и создать MR" })).toBeEnabled();
    checks.push(`${name}: submission sends title and multiline description; pending state blocks resubmission`);

    created = undefined;
    jobStatus = "running";
    await page.goto(`${base}/?create`);
    await page.getByRole("textbox", { name: "Название MR", exact: true }).fill("Updated guide");
    await page.getByRole("textbox", { name: "Описание MR (необязательно)" }).fill(description);
    assert((await page.getByRole("textbox", { name: "Описание MR (необязательно)" }).boundingBox()).height >= 140);
    assert((await page.getByRole("textbox", { name: "Описание MR (необязательно)" }).boundingBox()).height > (await page.getByRole("textbox", { name: "Название MR", exact: true }).boundingBox()).height);
    await page.screenshot({ path: `output/mr-feedback/${name}-create-review.png` });
    await page.getByRole("button", { name: "Создать MR", exact: true }).click();
    await expect.poll(() => created?.description).toBe(description);
    assert.equal(created.title, "Updated guide");
    await expect(page.getByRole("textbox", { name: "Описание MR (необязательно)" })).toBeDisabled();
    jobStatus = "done";
    await expect(page.getByRole("status")).toHaveText("MR создан");
    assert.deepEqual(errors, []);
    checks.push(`${name}: standalone MR creation sends description and completes without browser errors`);
    await page.close();
  }
  await writeFile("output/mr-feedback/browser-checks.json", JSON.stringify({ checks }, null, 2));
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
