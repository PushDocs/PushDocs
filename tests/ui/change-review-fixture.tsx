import { useEffect, useState } from "react";
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
  const reverting = new URLSearchParams(window.location.search).has("revert");
  const [state, setState] = useState({
    revision: 7,
    content: new URLSearchParams(window.location.search).has("delete-only")
      ? "first old\nsecond old\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast old\nend\n"
      : "first new\nsecond new\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast new\nend\n",
  });
  useEffect(() => {
    if (!reverting) return;
    const refresh = () => {
      void fetch("/fixture-changes")
        .then((response) => response.json())
        .then(setState);
    };
    window.addEventListener("fixture:refresh", refresh);
    return () => window.removeEventListener("fixture:refresh", refresh);
  }, [reverting]);
  return (
    <main className="page changes-page">
      <header className="page-header">
        <div>
          <h1>Изменения в ветке</h1>
          <p>6 файлов сохранены в PushDocs и ещё не отправлены в Git.</p>
        </div>
      </header>
      <ChangeReview
        projectId="project"
        branch="docs/update"
        revertContext={
          reverting
            ? { revision: state.revision, headSha: "head", ownerId: "user", canEditConfig: true }
            : undefined
        }
        files={
          reverting
            ? [
                {
                  path: "content/intro.md",
                  operation: "modify",
                  before:
                    "first old\nsecond old\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nlast old\nremoved\nend\n",
                  after: state.content,
                  binary: false,
                  existed: true,
                },
              ]
            : files
        }
      />
    </main>
  );
}
