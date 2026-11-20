# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: branch-conflicts.spec.ts >> conflict loader animates and the resolution fits the screen
- Location: tests/ui/branch-conflicts.spec.ts:104:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Версия docs/task' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Версия docs/task' }) with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Версия docs/task' })

```

```yaml
- navigation:
  - button "Документы"
  - button "MR"
  - button "Конфликты"
- banner:
  - heading "Разрешение конфликтов" [level=1]
  - paragraph:
    - code: docs/task
    - text: ←
    - code: main
  - link "Вернуться к MR":
    - /url: /projects/project/reviews?review=review
- paragraph: Выберите текст для каждого спорного фрагмента. Остальные изменения сохранятся автоматически. Когда всё будет готово, отправьте решение в docs/task.
- paragraph:
  - text: "docs/task:"
  - code: "12345678"
  - text: "· main:"
  - code: abcdef01
- 'group "Конфликтующие файлы: 1"':
  - text: "Конфликтующие файлы: 1"
  - heading "docs/articles/a-very-long-document-name-with-several-words-to-test-small-screens.md" [level=2]
  - paragraph: Обновите данные, чтобы увидеть только спорные фрагменты документа.
  - button "Обновить список конфликтов"
- button "Отправить исправления в docs/task" [disabled]
- paragraph:
  - link "Открыть MR в Git-провайдере":
    - /url: https://git.example/review
```

# Test source

```ts
  17  |         oursContent: "# Our title\n\nShared text",
  18  |         theirsContent: "# Target title\n\nShared text",
  19  |         oursExists: true,
  20  |         theirsExists: true,
  21  |       },
  22  |     ],
  23  |   };
  24  |   const bundle = await build({
  25  |     stdin: {
  26  |       contents: `
  27  |       import { createRoot } from "react-dom/client";
  28  |       import { useEffect, useState } from "react";
  29  |       import { BranchConflictNotice, BranchConflictResolver, ProjectConflictProgress, ReviewConflictFiles } from "./apps/web/src/components/branch-conflicts";
  30  |       import "./apps/web/src/app/globals.css";
  31  |       import "./packages/ui/src/styles.css";
  32  |       const props = {projectId:"project",reviewId:"review",branch:"docs/task",targetBranch:"main",defaultBranch:"main",ownerId:"user",canWrite:true,providerUrl:"https://git.example/review",reviewLabel:"MR"};
  33  |       function App() {
  34  |         const [section,setSection] = useState(location.search.includes("review") ? "review" : "resolver");
  35  |         useEffect(() => { const navigate = () => setSection("changes"); window.addEventListener("fixture:navigate",navigate); return () => window.removeEventListener("fixture:navigate",navigate); },[]);
  36  |         return <><ProjectConflictProgress projectId="project" ownerId="user" />
  37  |           <nav><button onClick={()=>setSection("documents")}>Документы</button><button onClick={()=>setSection("review")}>MR</button><button onClick={()=>setSection("resolver")}>Конфликты</button></nav>
  38  |           {section === "documents" ? <div className="page"><h1>Документы</h1></div> : section === "review" ? <div className="page"><ReviewConflictFiles {...props} /></div> : section === "changes" ? <div className="page"><h1>Изменения в ветке</h1><BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={true} /></div> : <BranchConflictResolver {...props} />}
  39  |         </>;
  40  |       }
  41  |       createRoot(document.getElementById("root")).render(<App />);
  42  |     `,
  43  |       resolveDir: process.cwd(),
  44  |       loader: "tsx",
  45  |     },
  46  |     bundle: true,
  47  |     write: false,
  48  |     outfile: "fixture.js",
  49  |     jsx: "automatic",
  50  |     define: { "process.env.NODE_ENV": '"development"' },
  51  |     plugins: [
  52  |       {
  53  |         name: "conflict-actions",
  54  |         setup(builder) {
  55  |           builder.onResolve(
  56  |             { filter: /^(@\/app\/(actions|conflict-actions)|next\/(link|navigation))$/ },
  57  |             (args) => ({ path: args.path, namespace: "fixture" }),
  58  |           );
  59  |           builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
  60  |             resolveDir: process.cwd(),
  61  |             loader: "js",
  62  |             contents:
  63  |               args.path === "next/link"
  64  |                 ? 'import {createElement} from "react"; export default (props) => createElement("a",props,props.children);'
  65  |                 : args.path === "next/navigation"
  66  |                   ? 'const router={replace(href){history.replaceState({},"",href);window.dispatchEvent(new Event("fixture:navigate"));}};export function useRouter(){return router;}'
  67  |                   : `
  68  |           export async function prepareConflictResolutionAction() { return []; }
  69  |           let polls=0;
  70  |           export async function inspectReviewConflictsAction() { window.inspectionStarts=(window.inspectionStarts||0)+1; await new Promise(r=>setTimeout(r, 700)); return "inspect"; }
  71  |           export async function gitOperationStatusAction(project, id) {
  72  |             if(id === "inspect" && polls++ === 0) return {status:"running", progress:"comparing-conflicts",transferProgress:{receivedBytes:12500000,totalBytes:null}};
  73  |             return {status:"done", conflictSnapshot: id === "inspect" ? ${JSON.stringify(snapshot)} : null};
  74  |           }
  75  |           export async function submitConflictResolutionAction() { return "publish"; }
  76  |           export async function retryConflictResolutionAction() { return "publish"; }
  77  |         `,
  78  |           }));
  79  |         },
  80  |       },
  81  |     ],
  82  |   });
  83  |   const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  84  |   const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  85  |   const server = createServer((request, response) => {
  86  |     const script = request.url === "/fixture.js";
  87  |     response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  88  |     response.end(
  89  |       script
  90  |         ? js
  91  |         : `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
  92  |     );
  93  |   });
  94  |   await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  95  |   const address = server.address();
  96  |   if (!address || typeof address === "string") throw new Error("Fixture did not start");
  97  |   fixture = {
  98  |     url: `http://127.0.0.1:${address.port}`,
  99  |     close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  100 |   };
  101 | });
  102 | test.afterAll(async () => fixture?.close());
  103 | 
  104 | test("conflict loader animates and the resolution fits the screen", async ({ page }, testInfo) => {
  105 |   await page.goto(`${fixture.url}?review`);
  106 |   const loader = page.getByRole("status").first();
  107 |   await expect(loader.locator("svg.spin")).toBeVisible();
  108 |   expect(
  109 |     await loader.locator("svg").evaluate((node) => getComputedStyle(node).animationName),
  110 |   ).not.toBe("none");
  111 |   await expect(page.getByText("Конфликтующие файлы: 1")).toBeVisible();
  112 |   await page.goto(fixture.url);
  113 |   await expect(page.getByRole("button", { name: "Проверить состояние и продолжить" })).toHaveCount(
  114 |     0,
  115 |   );
  116 |   await expect(page.getByRole("status").first().locator("svg.spin")).toBeVisible();
> 117 |   await expect(page.getByRole("heading", { name: "Версия docs/task" })).toBeVisible();
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  118 |   const submit = page.getByRole("button", { name: "Отправить исправления в docs/task" });
  119 |   await expect(submit).toBeDisabled();
  120 |   await page.getByLabel("Ручной результат").check();
  121 |   await page.getByRole("textbox").fill("# Combined title\n\nShared text");
  122 |   await expect(submit).toBeEnabled();
  123 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
  124 |     true,
  125 |   );
  126 |   await page.screenshot({
  127 |     path: `output/branch-conflicts/${testInfo.project.name}.png`,
  128 |     fullPage: true,
  129 |   });
  130 |   await submit.click();
  131 |   await expect(page.getByRole("heading", { name: "Решение отправлено в docs/task" })).toBeVisible();
  132 | });
  133 | 
  134 | test("project progress survives switching sections and reuses the same inspection", async ({
  135 |   page,
  136 | }) => {
  137 |   await page.goto(`${fixture.url}?review`);
  138 |   await page.getByRole("button", { name: "Документы", exact: true }).click();
  139 |   const progress = page.getByRole("complementary", { name: "Фоновые проверки конфликтов" });
  140 |   await expect(progress).toBeVisible();
  141 |   await expect(
  142 |     progress.getByText("Определяем конфликтующие файлы… (загружено 12,5 МБ)"),
  143 |   ).toBeVisible();
  144 |   await expect(page.getByRole("status")).toHaveCount(1);
  145 |   await expect(page.getByRole("progressbar")).toHaveCount(0);
  146 |   await expect(progress).toBeHidden();
  147 |   await page.getByRole("button", { name: "MR", exact: true }).click();
  148 |   await expect(page.getByText("Конфликтующие файлы: 1")).toBeVisible();
  149 |   expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts"))).toBe(1);
  150 | });
  151 | 
  152 | test("browser drafts lead to normal changes and a conflict notice without preparation", async ({
  153 |   page,
  154 | }) => {
  155 |   await page.addInitScript(() =>
  156 |     localStorage.setItem(
  157 |       'pushdocs:draft:["user","project","docs/task","docs/local.md"]',
  158 |       JSON.stringify({ text: "Unsaved", base: "Original" }),
  159 |     ),
  160 |   );
  161 |   await page.goto(fixture.url);
  162 |   await expect(page.getByRole("heading", { name: "Изменения в ветке" })).toBeVisible();
  163 |   await expect(page.getByText(/Сначала разберитесь с текущими правками/)).toBeVisible();
  164 |   await expect(page.getByText("Подготовка к разрешению конфликтов")).toHaveCount(0);
  165 |   expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts") || 0)).toBe(0);
  166 | });
  167 | 
```