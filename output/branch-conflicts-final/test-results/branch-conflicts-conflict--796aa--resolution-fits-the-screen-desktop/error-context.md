# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: branch-conflicts.spec.ts >> conflict loader animates and the resolution fits the screen
- Location: tests/ui/branch-conflicts.spec.ts:124:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('group', { name: 'Фрагмент 2 из 2 · Выберите текст' }).getByRole('textbox')

```

# Test source

```ts
  53  |       function App() {
  54  |         const [section,setSection] = useState(location.search.includes("review") ? "review" : "resolver");
  55  |         useEffect(() => { const navigate = () => setSection("changes"); window.addEventListener("fixture:navigate",navigate); return () => window.removeEventListener("fixture:navigate",navigate); },[]);
  56  |         return <><ProjectConflictProgress projectId="project" ownerId="user" />
  57  |           <nav><button onClick={()=>setSection("documents")}>Документы</button><button onClick={()=>setSection("review")}>MR</button><button onClick={()=>setSection("resolver")}>Конфликты</button></nav>
  58  |           {section === "documents" ? <div className="page"><h1>Документы</h1></div> : section === "review" ? <div className="page"><ReviewConflictFiles {...props} /></div> : section === "changes" ? <div className="page"><h1>Изменения в ветке</h1><BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={true} /></div> : <BranchConflictResolver {...props} />}
  59  |         </>;
  60  |       }
  61  |       createRoot(document.getElementById("root")).render(<App />);
  62  |     `,
  63  |       resolveDir: process.cwd(),
  64  |       loader: "tsx",
  65  |     },
  66  |     bundle: true,
  67  |     write: false,
  68  |     outfile: "fixture.js",
  69  |     jsx: "automatic",
  70  |     define: { "process.env.NODE_ENV": '"development"' },
  71  |     plugins: [
  72  |       {
  73  |         name: "conflict-actions",
  74  |         setup(builder) {
  75  |           builder.onResolve(
  76  |             { filter: /^(@\/app\/(actions|conflict-actions)|next\/(link|navigation))$/ },
  77  |             (args) => ({ path: args.path, namespace: "fixture" }),
  78  |           );
  79  |           builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
  80  |             resolveDir: process.cwd(),
  81  |             loader: "js",
  82  |             contents:
  83  |               args.path === "next/link"
  84  |                 ? 'import {createElement} from "react"; export default (props) => createElement("a",props,props.children);'
  85  |                 : args.path === "next/navigation"
  86  |                   ? 'const router={replace(href){history.replaceState({},"",href);window.dispatchEvent(new Event("fixture:navigate"));}};export function useRouter(){return router;}'
  87  |                   : `
  88  |           export async function prepareConflictResolutionAction() { return []; }
  89  |           let polls=0;
  90  |           export async function inspectReviewConflictsAction() { window.inspectionStarts=(window.inspectionStarts||0)+1; await new Promise(r=>setTimeout(r, 700)); return "inspect"; }
  91  |           export async function gitOperationStatusAction(project, id) {
  92  |             if(id === "inspect" && polls++ === 0) return {status:"running", progress:"comparing-conflicts",transferProgress:{receivedBytes:12500000,totalBytes:null}};
  93  |             return {status:"done", conflictSnapshot: id === "inspect" ? ${JSON.stringify(snapshot)} : null};
  94  |           }
  95  |           export async function submitConflictResolutionAction(project, inspection, files) { window.submittedFiles=files; return "publish"; }
  96  |           export async function retryConflictResolutionAction() { return "publish"; }
  97  |         `,
  98  |           }));
  99  |         },
  100 |       },
  101 |     ],
  102 |   });
  103 |   const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  104 |   const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  105 |   const server = createServer((request, response) => {
  106 |     const script = request.url === "/fixture.js";
  107 |     response.setHeader("Content-Type", script ? "text/javascript" : "text/html");
  108 |     response.end(
  109 |       script
  110 |         ? js
  111 |         : `<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`,
  112 |     );
  113 |   });
  114 |   await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  115 |   const address = server.address();
  116 |   if (!address || typeof address === "string") throw new Error("Fixture did not start");
  117 |   fixture = {
  118 |     url: `http://127.0.0.1:${address.port}`,
  119 |     close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  120 |   };
  121 | });
  122 | test.afterAll(async () => fixture?.close());
  123 | 
  124 | test("conflict loader animates and the resolution fits the screen", async ({ page }, testInfo) => {
  125 |   await page.goto(`${fixture.url}?review`);
  126 |   const loader = page.getByRole("status").first();
  127 |   await expect(loader.locator("svg.spin")).toBeVisible();
  128 |   expect(
  129 |     await loader.locator("svg").evaluate((node) => getComputedStyle(node).animationName),
  130 |   ).not.toBe("none");
  131 |   await expect(page.getByText("Конфликтующие файлы: 1")).toBeVisible();
  132 |   await page.goto(fixture.url);
  133 |   await expect(page.getByRole("button", { name: "Проверить состояние и продолжить" })).toHaveCount(
  134 |     0,
  135 |   );
  136 |   await expect(page.getByRole("status").first().locator("svg.spin")).toBeVisible();
  137 |   const first = page.getByRole("group", { name: "Фрагмент 1 из 2 · Выберите текст" });
  138 |   await expect(first).toBeVisible();
  139 |   await expect(page.locator(".conflict-document-preview")).not.toHaveAttribute("open");
  140 |   await expect(
  141 |     page.locator(".conflict-fragment").getByText("Неизменённый абзац 0", { exact: true }),
  142 |   ).toHaveCount(0);
  143 |   const submit = page.getByRole("button", { name: "Отправить исправления в docs/task" });
  144 |   await expect(submit).toBeDisabled();
  145 |   await first.getByLabel("Оставить ваш текст").check();
  146 |   await expect(submit).toBeDisabled();
  147 |   await page.reload();
  148 |   await expect(
  149 |     page.getByRole("group", { name: "Фрагмент 1 из 2 · Готово" }).getByLabel("Оставить ваш текст"),
  150 |   ).toBeChecked();
  151 |   const second = page.getByRole("group", { name: "Фрагмент 2 из 2 · Выберите текст" });
  152 |   await second.getByLabel("Свой текст").check();
> 153 |   await second.getByRole("textbox").fill("Combined ending\n");
      |                                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  154 |   await expect(submit).toBeEnabled();
  155 |   await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  156 |   await expect(page.getByRole("heading", { name: "Итоговый документ" })).toBeVisible();
  157 |   await expect(page.locator(".conflict-document-preview pre")).toContainText(
  158 |     "Неизменённый абзац 0",
  159 |   );
  160 |   await page.getByText("Посмотреть документ целиком", { exact: true }).click();
  161 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
  162 |     true,
  163 |   );
  164 |   await page.screenshot({
  165 |     path: `output/branch-conflicts/${testInfo.project.name}.png`,
  166 |     fullPage: true,
  167 |   });
  168 |   await submit.click();
  169 |   await expect(page.getByRole("heading", { name: "Решение отправлено в docs/task" })).toBeVisible();
  170 |   const files = await page.evaluate(() => Reflect.get(window, "submittedFiles"));
  171 |   expect(files[0].content).toContain("# Our title\n\nShared text\n\nCombined ending\n");
  172 |   expect(files[0].content).toContain("Неизменённый абзац 0\n");
  173 | });
  174 | 
  175 | test("project progress survives switching sections and reuses the same inspection", async ({
  176 |   page,
  177 | }) => {
  178 |   await page.goto(`${fixture.url}?review`);
  179 |   await page.getByRole("button", { name: "Документы", exact: true }).click();
  180 |   const progress = page.getByRole("complementary", { name: "Фоновые проверки конфликтов" });
  181 |   await expect(progress).toBeVisible();
  182 |   await expect(
  183 |     progress.getByText("Определяем конфликтующие файлы… (загружено 12,5 МБ)"),
  184 |   ).toBeVisible();
  185 |   await expect(page.getByRole("status")).toHaveCount(1);
  186 |   await expect(page.getByRole("progressbar")).toHaveCount(0);
  187 |   await expect(progress).toBeHidden();
  188 |   await page.getByRole("button", { name: "MR", exact: true }).click();
  189 |   await expect(page.getByText("Конфликтующие файлы: 1")).toBeVisible();
  190 |   expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts"))).toBe(1);
  191 | });
  192 | 
  193 | test("browser drafts lead to normal changes and a conflict notice without preparation", async ({
  194 |   page,
  195 | }) => {
  196 |   await page.addInitScript(() =>
  197 |     localStorage.setItem(
  198 |       'pushdocs:draft:["user","project","docs/task","docs/local.md"]',
  199 |       JSON.stringify({ text: "Unsaved", base: "Original" }),
  200 |     ),
  201 |   );
  202 |   await page.goto(fixture.url);
  203 |   await expect(page.getByRole("heading", { name: "Изменения в ветке" })).toBeVisible();
  204 |   await expect(page.getByText(/Сначала разберитесь с текущими правками/)).toBeVisible();
  205 |   await expect(page.getByText("Подготовка к разрешению конфликтов")).toHaveCount(0);
  206 |   expect(await page.evaluate(() => Reflect.get(window, "inspectionStarts") || 0)).toBe(0);
  207 | });
  208 | 
```