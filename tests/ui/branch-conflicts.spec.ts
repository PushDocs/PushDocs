import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let fixture: { url: string; close: () => Promise<void> };
test.beforeAll(async () => {
  const intro =
    "# Начало документа\n" +
    Array.from({ length: 30 }, (_, index) => `Неизменённый абзац ${index}\n\n`).join("");
  const middle = "\nShared text\n\n";
  const snapshot = {
    branch: "docs/task",
    sourceBranch: "main",
    parentSha: "12345678",
    sourceSha: "abcdef01",
    mediaContentsSkipped: true,
    files: [
      {
        path: "docs/articles/a-very-long-document-name-with-several-words-to-test-small-screens.md",
        kind: "text",
        baseContent: `${intro}# Original\n${middle}Original ending\nOriginal details\n`,
        oursContent: `${intro}# Our title\n${middle}Our ending\nMore details\n`,
        theirsContent: `${intro}# Target title\n${middle}Target ending\nOther details\n`,
        sections: [
          { kind: "text", content: intro },
          {
            kind: "conflict",
            base: "# Original\n",
            ours: "# Our title\n",
            theirs: "# Target title\n",
          },
          { kind: "text", content: middle },
          {
            kind: "conflict",
            base: "Original ending\nOriginal details\n",
            ours: "Our ending\nMore details\n",
            theirs: "Target ending\nOther details\n",
          },
        ],
        oursExists: true,
        theirsExists: true,
      },
    ],
  };
  const bundle = await build({
    stdin: {
      contents: `
      import { createRoot } from "react-dom/client";
      import { useEffect, useState } from "react";
      import { BranchConflictNotice, BranchConflictResolver, DocumentBranchConflicts, ProjectConflictProgress, ReviewConflictFiles } from "./apps/web/src/components/branch-conflicts";
      import "./apps/web/src/app/globals.css";
      import "./apps/web/src/app/workbench.css";
      import "./packages/ui/src/styles.css";
      const props = {projectId:"project",reviewId:"review",branch:"docs/task",targetBranch:"main",defaultBranch:"main",ownerId:"user",canWrite:true,providerUrl:"https://git.example/review",reviewLabel:"MR"};
      function App() {
        const [section,setSection] = useState(location.search.includes("documents") ? "documents" : location.search.includes("review") ? "review" : "resolver");
        useEffect(() => { const navigate = () => setSection("changes"); window.addEventListener("fixture:navigate",navigate); return () => window.removeEventListener("fixture:navigate",navigate); },[]);
        return <><ProjectConflictProgress projectId="project" ownerId="user" hidden={section === "documents"} />
          <nav><button onClick={()=>setSection("documents")}>Документы</button><button onClick={()=>setSection("review")}>MR</button><button onClick={()=>setSection("resolver")}>Конфликты</button></nav>
          {section === "documents" ? <div className="page"><h1>Документы</h1><div className="wb-branch-conflicts"><DocumentBranchConflicts {...props} canInspect hasPendingChanges={false} /></div></div> : section === "review" ? <div className="page"><ReviewConflictFiles {...props} /></div> : section === "changes" ? <div className="page"><h1>Изменения в ветке</h1><BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={true} /></div> : <BranchConflictResolver {...props} />}
        </>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "conflict-actions",
        setup(builder) {
          builder.onResolve(
            { filter: /^(@\/app\/(actions|conflict-actions)|next\/(link|navigation))$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            resolveDir: process.cwd(),
            loader: "js",
            contents:
              args.path === "next/link"
                ? 'import {createElement} from "react"; export default (props) => createElement("a",props,props.children);'
                : args.path === "next/navigation"
                  ? 'const router={replace(href){history.replaceState({},"",href);window.dispatchEvent(new Event("fixture:navigate"));}};export function useRouter(){return router;}'
                  : `
          export async function prepareConflictResolutionAction() { return []; }
          let polls=0;
          export async function inspectReviewConflictsAction() { window.inspectionStarts=(window.inspectionStarts||0)+1; await new Promise(r=>setTimeout(r, 700)); if(location.search.includes("failed") && window.inspectionStarts === 1) throw new Error("GitLab is not responding"); return "inspect"; }
          export async function gitOperationStatusAction(project, id) {
            if(id === "inspect" && polls++ === 0) return {status:"running", progress:"comparing-conflicts",transferProgress:{receivedBytes:12500000,totalBytes:null}};
            return {status:"done", conflictSnapshot: id === "inspect" ? ${JSON.stringify(snapshot)} : null};
          }
          export async function submitConflictResolutionAction(project, inspection, files) { window.submittedFiles=files; return "publish"; }
          export async function retryConflictResolutionAction() { return "publish"; }
        `,
          }));
        },
      },
    ],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  const server = createServer((request, response) => {
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
  fixture = {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
});
test.afterAll(async () => fixture?.close());

test("refresh keeps the conflict list visible while the button spins", async ({ page }) => {
  await page.goto(`${fixture.url}?review`);
  const files = page.locator(".review-conflict-files li");
  await expect(files).toHaveCount(1);
  const paths = await files.allTextContents();
  await expect(page.getByText(/Медиа проверены по версиям файлов/)).toHaveCount(0);
  const refresh = page.getByRole("button", { name: "Обновить список конфликтов" });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute("aria-busy", "true");
  await expect(refresh.locator("svg.spin")).toBeVisible();
  expect(
    await refresh.locator("svg.spin").evaluate((node) => getComputedStyle(node).animationName),
  ).not.toBe("none");
  await expect(files).toHaveText(paths);
  await expect(refresh).toBeEnabled();
  await expect(refresh.locator("svg.spin")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts"))).toBe(2);
});

test("conflict loader animates and the resolution fits the screen", async ({ page }, testInfo) => {
  await page.goto(`${fixture.url}?review`);
  const loader = page.getByRole("status").first();
  await expect(loader.locator("svg.spin")).toBeVisible();
  expect(
    await loader.locator("svg").evaluate((node) => getComputedStyle(node).animationName),
  ).not.toBe("none");
  await expect(
    page.getByText(/^(Конфликтующие файлы|Предварительный список конфликтов): 1$/),
  ).toBeVisible();
  await page.goto(fixture.url);
  await expect(page.getByRole("button", { name: "Проверить состояние и продолжить" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("status").first().locator("svg.spin")).toBeVisible();
  const first = page.getByRole("group", { name: "Фрагмент 1 из 2 · Выберите текст" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("radio", { name: "Откатить до main", exact: true })).toBeVisible();
  await expect(page.locator(".branch-conflict-instructions")).toContainText(
    "Остальные изменения сохранятся автоматически",
  );
  await expect(page.getByText(/Содержимое медиа не загружалось/)).toHaveCount(0);
  await expect(page.getByText("12345678", { exact: true })).toHaveCount(0);
  await expect(first.locator(".wb-markdown")).toHaveCount(0);
  const removed = first.locator('.conflict-diff-changes [data-kind="delete"]');
  const added = first.locator('.conflict-diff-changes [data-kind="add"]');
  await expect(removed).toContainText("# Our title");
  await expect(added).toContainText("# Target title");
  expect(await removed.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    await added.evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await expect(page.locator(".conflict-document-preview")).not.toHaveAttribute("open");
  await expect(
    page.locator(".conflict-fragment").getByText("Неизменённый абзац 0", { exact: true }),
  ).toHaveCount(0);
  const submit = page.getByRole("button", { name: "Отправить исправления в docs/task" });
  await expect(submit).toBeDisabled();
  await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Предварительный результат" })).toBeVisible();
  await expect(page.locator(".conflict-document-explanation")).toContainText(
    "нерешённых фрагментах (2)",
  );
  await expect(page.locator(".conflict-document-source")).toContainText("# Our title");
  await expect(page.locator(".conflict-document-source")).not.toContainText("# Target title");
  await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  await first.getByLabel("Оставить ваш текст").check();
  const chosenFirst = page.getByRole("group", { name: /Фрагмент 1 из 2/ });
  const rejected = chosenFirst.locator('.conflict-diff-changes [data-kind="add"]');
  await expect(rejected).toHaveAttribute("data-discarded", "true");
  await expect(rejected).not.toHaveAttribute("open");
  await expect(rejected.locator(".conflict-source-line")).toBeHidden();
  await rejected.locator("summary").click();
  await expect(rejected.locator(".conflict-source-line")).toBeVisible();
  expect(
    await rejected
      .locator(".conflict-diff-discarded-content")
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toBe("none");
  await rejected.locator("summary").click();
  await expect(chosenFirst.locator('.conflict-diff-changes [data-kind="delete"]')).toHaveAttribute(
    "data-discarded",
    "false",
  );
  await chosenFirst.getByLabel("Оставить ваш текст").click();
  await expect(chosenFirst.getByLabel("Оставить ваш текст")).not.toBeChecked();
  await expect(chosenFirst.locator("details.conflict-diff-block")).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await chosenFirst.getByLabel("Оставить ваш текст").check();
  await expect(submit).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Фрагмент 1 из 2 · Готово" }).getByLabel("Оставить ваш текст"),
  ).toBeChecked();
  const second = page.getByRole("group", { name: /Фрагмент 2 из 2/ });
  await second.getByRole("radio", { name: "Свой текст", exact: true }).check();
  await expect(
    second.locator('.conflict-diff-block[data-kind="delete"] .conflict-source-line'),
  ).toHaveCount(2);
  await expect(second.locator('.conflict-diff-block[data-kind="delete"]')).toHaveAttribute(
    "data-discarded",
    "true",
  );
  await expect(second.locator('.conflict-diff-block[data-kind="add"]')).toHaveAttribute(
    "data-discarded",
    "true",
  );
  const rejectedOurs = second.locator('.conflict-diff-block[data-kind="delete"]');
  const rejectedTheirs = second.locator('.conflict-diff-block[data-kind="add"]');
  await expect(rejectedOurs).not.toHaveAttribute("open");
  await expect(rejectedTheirs).not.toHaveAttribute("open");
  await expect(rejectedOurs.locator(".conflict-source-line").first()).toBeHidden();
  await rejectedOurs.locator("summary").click();
  await expect(rejectedOurs.locator(".conflict-source-line").first()).toBeVisible();
  expect(
    await second
      .locator('.conflict-diff-block[data-kind="delete"] .conflict-source-line')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toBe("none");
  await second.getByRole("textbox").fill("Live custom text\n");
  await expect(rejectedOurs).toHaveAttribute("open");
  await expect(second.getByRole("region", { name: "Свой вариант в сравнении" })).toContainText(
    "Live custom text",
  );
  await second.getByRole("textbox").fill("Combined ending\n");
  await expect(second.getByRole("region", { name: "Свой вариант в сравнении" })).toContainText(
    "Combined ending",
  );
  const custom = second.getByRole("region", { name: "Свой вариант в сравнении" });
  await expect(custom.getByRole("heading")).toHaveCount(0);
  await expect(second.getByText(/^Итоговый текст фрагмента/)).toHaveCount(0);
  expect(await custom.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    await second
      .locator('.conflict-source-line[data-context="true"]')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await rejectedOurs.locator("summary").click();
  await second.getByRole("radio", { name: "Свой текст", exact: true }).click();
  await expect(second.getByRole("radio", { name: "Свой текст", exact: true })).not.toBeChecked();
  await expect(second.locator(".conflict-diff-manual")).toHaveCount(0);
  await expect(second.locator("details.conflict-diff-block")).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await second.getByRole("radio", { name: "Свой текст", exact: true }).check();
  await expect(second.getByRole("textbox")).toHaveValue("Combined ending\n");
  await expect(submit).toBeEnabled();
  await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Итоговый документ", exact: true })).toBeVisible();
  await expect(page.locator(".conflict-document-explanation")).toContainText(
    "Все выбранные решения применены",
  );
  await expect(page.locator(".conflict-document-source")).toContainText("Неизменённый абзац 0");
  await expect(page.getByRole("region", { name: "Фрагмент 1 в документе" })).toBeVisible();
  await expect(
    page.locator('.conflict-document-source [data-context="true"]').first(),
  ).toBeVisible();
  await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `output/branch-conflicts/fragment-resolution-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await submit.click();
  await expect(page.getByRole("heading", { name: "Решение отправлено в docs/task" })).toBeVisible();
  const files = await page.evaluate(() => Reflect.get(window, "submittedFiles"));
  expect(files[0].content).toContain("# Our title\n\nShared text\n\nCombined ending\n");
  expect(files[0].content).toContain("Неизменённый абзац 0\n");
});

test("documents keep the conflict list after background progress finishes and reuse the inspection", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}?review`);
  await page.getByRole("button", { name: "Документы", exact: true }).click();
  const notice = page.getByRole("region", { name: "Конфликты между ветками" });
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Фоновые проверки конфликтов" }),
  ).toHaveCount(0);
  await expect(
    notice.getByText("Определяем конфликтующие файлы… (загружено 12,5 МБ)"),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(notice.locator(".review-conflict-files li")).toHaveCount(1);
  await expect(notice.getByRole("link", { name: "Разрешить конфликты" })).toHaveAttribute(
    "href",
    "/projects/project/changes?branch=docs%2Ftask&resolve=review",
  );
  await expect(notice.getByRole("link", { name: "Разрешить конфликты" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `output/branch-conflicts/documents-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "MR", exact: true }).click();
  await expect(
    page.getByText(/^(Конфликтующие файлы|Предварительный список конфликтов): 1$/),
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts"))).toBe(1);
});

test("documents show a retryable inspection error without losing the conflict notice", async ({
  page,
}) => {
  await page.goto(`${fixture.url}?documents&failed`);
  const notice = page.getByRole("region", { name: "Конфликты между ветками" });
  await expect(notice.getByRole("alert")).toContainText("GitLab is not responding");
  await expect(notice.getByRole("link", { name: "Разрешить конфликты" })).toBeVisible();
  await notice.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(notice.locator(".review-conflict-files li")).toHaveCount(1);
  await expect(notice.getByRole("alert")).toHaveCount(0);
});

test("browser drafts lead to normal changes and a conflict notice without preparation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'pushdocs:draft:["user","project","docs/task","docs/local.md"]',
      JSON.stringify({ text: "Unsaved", base: "Original" }),
    ),
  );
  await page.goto(fixture.url);
  await expect(page.getByRole("heading", { name: "Изменения в ветке" })).toBeVisible();
  await expect(page.getByText(/Сначала разберитесь с текущими правками/)).toBeVisible();
  await expect(page.getByText("Подготовка к разрешению конфликтов")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts") || 0)).toBe(0);
});
