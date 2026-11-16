import { ChangeReview } from "../../apps/web/src/components/change-review";

const files = [
  { path: "assets/banner.svg", operation: "add", binary: true },
  { path: "content/start.mdx", operation: "modify", binary: false },
  { path: ".pushdocs/config.json", operation: "modify", binary: false },
  { path: "assets/screenshot.png", operation: "modify", binary: true },
  { path: "content/intro.md", operation: "modify", binary: false },
  { path: "assets/guide.pdf", operation: "delete", binary: true },
].map((file) => ({
  ...file,
  before: "# Работа с документами\n\nОткройте статью для редактирования.",
  after: "# Работа с документами\n\nОткройте статью, внесите правки и проверьте изменения.",
  existed: file.operation !== "add",
}));

export function ChangeReviewFixture() {
  return (
    <main className="page changes-page">
      <header className="page-header">
        <div>
          <h1>Изменения в ветке</h1>
          <p>6 файлов сохранены в PushDocs и ещё не отправлены в Git.</p>
        </div>
      </header>
      <ChangeReview projectId="project" branch="docs/update" files={files} />
    </main>
  );
}
