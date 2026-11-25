import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolvedBranchUpdatePolicy } from "../fixtures/branch-update-policy";

let fixture: { url: string; close: () => Promise<void> };
test.beforeAll(async () => {
  const intro =
    "# Начало документа\n" +
    Array.from({ length: 30 }, (_, index) => `Неизменённый абзац ${index}\n\n`).join("");
  const middle = "\nShared text\n\n";
  const snapshot = {
    updatePolicy: resolvedBranchUpdatePolicy({ targetSha: "abcdef01" }),
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
      import { ReviewBranchUpdate } from "./apps/web/src/components/review-branch-update";
      import { PausedRebaseNotice } from "./apps/web/src/components/paused-rebase-notice";
      import { Check, FileText, GitBranch } from "lucide-react";
      import "./apps/web/src/app/globals.css";
      import "./apps/web/src/app/workbench.css";
      import "./packages/ui/src/styles.css";
      const withoutReview=location.search.includes("branch-update") || sessionStorage.getItem("fixture-branch-update")==="true";
      if(withoutReview) { sessionStorage.setItem("fixture-branch-update","true"); if(sessionStorage.getItem("rebase-step")===null) sessionStorage.setItem("rebase-step","1"); }
      const props = {projectId:"project",reviewId:withoutReview ? "branch-update:operation" : "review",branch:"docs/task",targetBranch:"main",defaultBranch:"main",ownerId:"user",canWrite:true,providerUrl:withoutReview ? undefined : "https://git.example/review",reviewLabel:"MR"};
      const isRebase=location.search.includes("rebase") || sessionStorage.getItem("fixture-rebase")==="true";
      const isPausedRebase=location.search.includes("paused-rebase");
      const closedReview=location.search.includes("closed");
      if(isPausedRebase && sessionStorage.getItem("rebase-step")===null) sessionStorage.setItem("rebase-step","1");
      if(isRebase) sessionStorage.setItem("fixture-rebase","true");
      function App() {
        const [section,setSection] = useState(location.search.includes("resolve=") ? "resolver" : isRebase || withoutReview ? "changes" : location.search.includes("documents") ? "documents" : location.search.includes("review") ? "review" : "resolver");
        const [,setVersion] = useState(0);
        useEffect(() => {
          const navigate = () => setSection("changes");
          const resolve = () => setSection("resolver");
          const refresh = () => setVersion(value=>value+1);
          window.addEventListener("fixture:navigate",navigate);
          window.addEventListener("fixture:resolve",resolve);
          window.addEventListener("fixture:refresh",refresh);
          return () => { window.removeEventListener("fixture:navigate",navigate); window.removeEventListener("fixture:resolve",resolve); window.removeEventListener("fixture:refresh",refresh); };
        },[]);
        const step=Number(sessionStorage.getItem("rebase-step")||0);
        if(withoutReview) return section === "resolver" ? <BranchConflictResolver {...props} /> : <div className="page"><h1>Изменения в ветке</h1>{step<3 ? <BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={false} /> : <p>Ветка обновлена</p>}</div>;
        if(isPausedRebase) return <div className="page changes-page">
          <header className="page-header"><div><h1>Изменения в ветке</h1></div><div className="changes-header-actions"><span className="branch-placeholder"><GitBranch aria-hidden size={15} />docs/task</span></div></header>
          <ol className="branch-workflow" aria-label="Этапы работы с веткой"><li className="complete"><span><Check aria-hidden size={13}/></span>Правки</li><li className="complete"><span><Check aria-hidden size={13}/></span>Коммит в ветку</li><li className="active" aria-current="step"><span>3</span>MR</li></ol>
          {step>0 ? <PausedRebaseNotice projectId="project" reviewId="review" branch="docs/task" operationId="rebase" conflictId="conflict-1" canResolve={!closedReview} canWrite /> : null}
          <section className="empty-state"><FileText aria-hidden/><h2>{step>0 ? "Нет локальных правок" : "Все изменения отправлены"}</h2><a className="pd-button pd-button--secondary" href="https://git.example/review" target="_blank" rel="noreferrer">Открыть MR</a><a className="pd-button pd-button--secondary" href="/projects/project/documents?branch=docs%2Ftask">Открыть документы</a></section>
        </div>;
        const updateNotice = isRebase && step<3 ? <ReviewBranchUpdate projectId="project" ownerId="user" canWrite provider="gitlab" waitingForResolution={step>0} review={{id:"review",head_sha:"12345678",source_branch:"docs/task",target_branch:"main",provider_url:props.providerUrl,details:{updateRequired:true,readiness:{state:"blocked",reason:step>0?"conflict":"need_rebase"},source:{isFork:false},branchUpdatePolicy:{...${JSON.stringify(snapshot.updatePolicy)},strategy:"rebase"}}}} /> : null;
        return <><ProjectConflictProgress projectId="project" ownerId="user" hidden={section === "documents"} />
          <nav><button onClick={()=>setSection("documents")}>Документы</button><button onClick={()=>setSection("review")}>MR</button><button onClick={()=>setSection("resolver")}>Конфликты</button></nav>
          {section === "documents" ? <div className="page"><h1>Документы</h1><div className="wb-branch-conflicts"><DocumentBranchConflicts {...props} canInspect hasPendingChanges={false} /></div></div> : section === "review" ? <div className="page"><ReviewConflictFiles {...props} /></div> : section === "changes" ? <div className="page"><h1>Изменения в ветке</h1>{isRebase ? updateNotice : <BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={true} />}</div> : <BranchConflictResolver {...props} />}
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
                ? 'import {createElement} from "react"; export default (props) => createElement("a",{...props,onClick:props.href.includes("resolve=") ? event=>{event.preventDefault();history.pushState({},"",props.href);window.dispatchEvent(new Event("fixture:resolve"));} : undefined},props.children);'
                : args.path === "next/navigation"
                  ? 'const router={replace(href){history.replaceState({},"",href);window.dispatchEvent(new Event("fixture:navigate"));},push(href){this.replace(href);},refresh(){window.dispatchEvent(new Event("fixture:refresh"));}};export function useRouter(){return router;}'
                  : `
          const isRebase=location.search.includes("rebase") || sessionStorage.getItem("fixture-rebase")==="true";
          const withoutReview=location.search.includes("branch-update") || sessionStorage.getItem("fixture-branch-update")==="true";
          const step=()=>Number(sessionStorage.getItem("rebase-step")||0);
          const snapshot=${JSON.stringify(snapshot)};
          if(isRebase) snapshot.updatePolicy.strategy="rebase";
          export async function prepareConflictResolutionAction() { return (isRebase || withoutReview) && step()>0 && step()<3 ? [{branch:"docs/task",paths:[],busy:true,mergeJobId:withoutReview ? "operation" : "rebase"}] : []; }
          let polls=0;
          export async function inspectReviewConflictsAction() { if(withoutReview) return "operation"; window.inspectionStarts=(window.inspectionStarts||0)+1; await new Promise(r=>setTimeout(r, 700)); if(location.search.includes("failed") && window.inspectionStarts === 1) throw new Error("GitLab is not responding"); return "inspect"; }
          export async function gitOperationStatusAction(project, id) {
            if(id === "operation") { await new Promise(resolve=>setTimeout(resolve,300)); return step()<3 ? {status:"needs_resolution",conflictSnapshot:{...snapshot,...(isRebase ? {rebase:{operationId:"operation",conflictId:"conflict-"+step(),commitSha:"commit-"+step(),currentParentSha:"current",originalParentSha:"original",index:step(),total:2,title:"Edit "+step()}} : {merge:{operationId:"operation",conflictId:"merge-token"}})}} : {status:"done"}; }
            if(id === "rebase") { await new Promise(resolve=>setTimeout(resolve,500)); return step()<3 ? {status:"needs_resolution",conflictSnapshot:{...snapshot,rebase:{operationId:"rebase",conflictId:"conflict-"+step(),commitSha:"commit-"+step(),currentParentSha:"current",originalParentSha:"original",index:step(),total:2,title:"Edit "+step()}}} : {status:"done"}; }
            if(id === "inspect" && polls++ === 0) return {status:"running", progress:"comparing-conflicts",transferProgress:{receivedBytes:12500000,totalBytes:null}};
            return {status:"done", conflictSnapshot: id === "inspect" ? snapshot : null};
          }
          export async function startGitOperationAction() {window.updateStarts=(window.updateStarts||0)+1;sessionStorage.setItem("rebase-step","1");return "rebase";}
          export async function cancelRebaseUpdateAction(...args) {window.cancelledRebase=args;await new Promise(resolve=>setTimeout(resolve,300));sessionStorage.setItem("rebase-step","0");}
          export async function submitConflictResolutionAction(project, inspection, files, conflictId, mergeConflictId) { window.submittedFiles=files; window.submittedOperation={inspection,conflictId,mergeConflictId}; if(withoutReview && !isRebase){sessionStorage.setItem("rebase-step","3");return "operation";} if(isRebase){sessionStorage.setItem("rebase-decisions",JSON.stringify([...(JSON.parse(sessionStorage.getItem("rebase-decisions")||"[]")),conflictId]));sessionStorage.setItem("rebase-step",String(step()+1));return withoutReview ? "operation" : "rebase";} return "publish"; }
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

for (const strategy of ["merge", "rebase"]) {
  test(`resolves a ${strategy} update through the existing Changes notice before creating an MR`, async ({
    page,
  }) => {
    await page.goto(`${fixture.url}?branch-update${strategy === "rebase" ? "&rebase" : ""}`);
    await expect(page.getByRole("heading", { name: "Исправьте конфликты" })).toBeVisible();
    await page.getByRole("link", { name: "Исправить конфликты" }).click();
    await expect(
      page.getByRole("heading", { name: "Разрешение конфликтов", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Вернуться к изменениям" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Открыть MR" })).toHaveCount(0);
    const label = strategy === "rebase" ? "Оставить актуальную основу" : "Оставить ваш текст";
    await page.getByRole("radio", { name: label }).first().check();
    await page.reload();
    await expect(page.getByRole("radio", { name: label }).first()).toBeChecked();
    for (const radio of await page.getByRole("radio", { name: label }).all()) await radio.check();
    await page
      .getByRole("button", {
        name:
          strategy === "rebase" ? "Сохранить и продолжить" : "Отправить исправления в docs/task",
      })
      .click();
    if (strategy === "rebase") {
      await expect(page.getByRole("heading", { name: "Коммит 2 из 2" })).toBeVisible();
      for (const radio of await page.getByRole("radio", { name: label }).all()) await radio.check();
      await page.getByRole("button", { name: "Сохранить и продолжить" }).click();
      await expect(page.getByText("Ветка обновлена", { exact: true })).toBeVisible();
    } else
      await expect(
        page.getByRole("heading", { name: "Решение отправлено в docs/task" }),
      ).toBeVisible();
    expect(await page.evaluate(() => Reflect.get(window, "submittedOperation"))).toMatchObject({
      inspection: "operation",
    });
  });
}

test("changes page cancels a paused rebase after its MR closes", async ({ page }, testInfo) => {
  await page.goto(`${fixture.url}?paused-rebase&closed`);
  const notice = page.getByRole("region", { name: "Приостановленный rebase" });
  await expect(notice.getByRole("button", { name: "Отменить rebase" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Исправить конфликты" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `output/branch-conflicts/paused-rebase-closed-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await notice.getByRole("button", { name: "Отменить rebase" }).click();
  await expect(notice.getByRole("button", { name: "Отменяем rebase…" })).toBeDisabled();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Все изменения отправлены" })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "cancelledRebase"))).toEqual([
    "project",
    "rebase",
    "conflict-1",
  ]);
});

test("changes page keeps resolution beside cancellation for an open MR", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}?paused-rebase`);
  const notice = page.getByRole("region", { name: "Приостановленный rebase" });
  await expect(notice.getByRole("link", { name: "Исправить конфликты" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Отменить rebase" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `output/branch-conflicts/paused-rebase-open-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("rebase resolves successive commits on the same screen and resumes after reload", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture.url}?rebase`);
  await page.getByRole("button", { name: "Обновить ветку" }).click();
  await expect(page.getByRole("heading", { name: "Исправьте конфликты" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Обновление ветки" })).toHaveCount(0);
  await page.getByRole("link", { name: "Исправить конфликты" }).click();
  await expect(page.getByRole("heading", { name: "Коммит 1 из 2" })).toBeVisible();
  await expect(page.locator(".page-header p")).toHaveText("docs/task ← main (rebase)");
  await expect(page.getByRole("button", { name: "Начать rebase" })).toHaveCount(0);
  await expect(page.getByText(/Для проекта выбран rebase/)).toHaveCount(0);
  await page.screenshot({
    path: `output/branch-conflicts/rebase-${testInfo.project.name}.png`,
    fullPage: true,
  });
  for (const radio of await page.getByRole("radio", { name: "Оставить актуальную основу" }).all())
    await radio.check();
  await page.getByRole("button", { name: "Сохранить и продолжить" }).click();
  await expect(page.getByText("Обновляем ветку из main…")).toBeVisible();
  await expect(page.locator(".branch-conflict-files")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Коммит 2 из 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить и продолжить" })).toBeDisabled();
  const radio = page.getByRole("radio", { name: "Применить изменения коммита" });
  await radio.first().check();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Коммит 2 из 2" })).toBeVisible();
  await expect(radio.first()).toBeChecked();
  for (const choice of await radio.all()) await choice.check();
  await page.getByRole("button", { name: "Сохранить и продолжить" }).click();
  await expect(page.getByText("Обновляем ветку из main…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Изменения в ветке" })).toBeVisible();
  await expect(page.locator(".branch-notice")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem("rebase-decisions") || "[]")),
  ).toEqual(["conflict-1", "conflict-2"]);
});

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
  await expect(notice.getByRole("link", { name: "Исправить конфликты" })).toHaveAttribute(
    "href",
    "/projects/project/changes?branch=docs%2Ftask&resolve=review",
  );
  await expect(notice.getByRole("link", { name: "Исправить конфликты" })).toBeInViewport();
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
  await expect(notice.getByRole("link", { name: "Исправить конфликты" })).toBeVisible();
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
  await expect(page.getByText(/Сохраните текущие правки/)).toBeVisible();
  await expect(page.getByText("Подготовка к разрешению конфликтов")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts") || 0)).toBe(0);
});
