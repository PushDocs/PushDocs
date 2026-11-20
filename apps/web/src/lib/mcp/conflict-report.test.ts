import {
  BranchConflictChoice,
  type BranchConflictSnapshot,
  ConflictReportMode,
  conflictReportLimits,
} from "@pushdocs/contracts";
import { describe, expect, it } from "vitest";
import { conflictReport, conflictResolutionInput, conflictResolutions } from "./conflict-report";

function reportSnapshot(): BranchConflictSnapshot {
  return {
    branch: "doc/814",
    sourceBranch: "stable",
    parentSha: "branch-sha",
    sourceSha: "stable-sha",
    history: {
      base: { sha: "base-sha", committedAt: "2026-11-01T09:00:00+03:00" },
      branch: { sha: "branch-sha", committedAt: "2026-11-14T09:00:00+03:00" },
      target: { sha: "stable-sha", committedAt: "2026-11-12T09:00:00+03:00" },
    },
    files: [
      {
        path: "manual/docs/список контактов.mdx",
        kind: "text",
        oursExists: true,
        theirsExists: true,
        baseContent: "# Контакты\n\n## Фильтры\n\nВыберите список.\n\nКонец.\n",
        oursContent: "# Контакты\n\n## Фильтры\n\nВыберите список получателей.\n\nПравка ветки.\n",
        theirsContent: "# Контакты\n\n## Фильтры\n\nДобавьте в список.\n\nПравка stable.\n",
        sections: [
          { kind: "text", content: "# Контакты\n\n## Фильтры\n\n" },
          {
            kind: "conflict",
            base: "Выберите список.\n",
            ours: "Выберите список получателей.\n",
            theirs: "Добавьте в список.\n",
          },
          { kind: "text", content: "\nПравка ветки.\nПравка stable.\n" },
        ],
      },
      {
        path: "manual/static/img/how-to.gif",
        kind: "binary",
        oursExists: true,
        theirsExists: false,
        baseContent: null,
        oursContent: null,
        theirsContent: null,
        versions: {
          base: { sha: "old", mode: "100644" },
          ours: { sha: "new", mode: "100644" },
          theirs: null,
        },
        mediaReferences: {
          complete: true,
          articles: [
            { version: "branch", path: "manual/docs/список контактов.mdx", title: "Контакты" },
          ],
        },
      },
    ],
  };
}
const links = {
  appOrigin: "https://pushdocs.test",
  projectId: "project",
  rootPath: "manual",
  provider: "gitlab" as const,
  repositoryUrl: "https://gitlab.test/group/docs",
  reviewUrl: "https://gitlab.test/group/docs/-/merge_requests/814",
};
const input = { mode: ConflictReportMode.Editorial, offset: 0, limit: 5, fragmentOffset: 0 };

function firstTextItem(report: ReturnType<typeof conflictReport>) {
  const item = report.items[0];
  if (!item || !("fragments" in item)) throw new Error("Expected text conflict");
  return item;
}

describe("editorial conflict evidence", () => {
  it("does not describe unsupported structural conflicts as a file deletion", () => {
    const snapshot = reportSnapshot();
    const file = snapshot.files[0];
    if (!file) throw new Error("Missing fixture");
    Object.assign(file, {
      kind: "unsupported",
      oursExists: false,
      theirsExists: false,
      baseContent: null,
      oursContent: null,
      theirsContent: null,
      sections: undefined,
    });
    snapshot.unsupportedReason = "Rename requires external resolution";
    expect(conflictReport(snapshot, links, { ...input, path: file.path })).toMatchObject({
      unsupportedReason: snapshot.unsupportedReason,
      items: [{ facts: { type: "unsupported" } }],
    });
  });
  it("includes original/version dates, article title/section and immutable links with repository root", () => {
    const report = conflictReport(reportSnapshot(), links, input);
    expect(report.versions?.base.committedAt).toContain("2026-11-01");
    expect(report.items[0]).toMatchObject({
      title: "Контакты",
      facts: { branchChanged: true, targetChanged: true },
      fragments: [
        {
          base: { text: "Выберите список.\n", truncated: false },
          context: { branch: { heading: "Фильтры" } },
        },
      ],
    });
    expect(report.items[0]?.links.target).toBe(
      "https://gitlab.test/group/docs/-/blob/stable-sha/manual/docs/%D1%81%D0%BF%D0%B8%D1%81%D0%BE%D0%BA%20%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D0%BE%D0%B2.mdx",
    );
    const editor = new URL(report.items[0]?.editorUrl ?? "");
    expect(editor.origin).toBe("https://pushdocs.test");
    expect(editor.searchParams.get("path")).toBe("docs/список контактов.mdx");
  });

  it.each([ConflictReportMode.Editorial, ConflictReportMode.Detailed])(
    "never exposes media contents in %s mode",
    (mode) => {
      const snapshot = reportSnapshot();
      const file = snapshot.files[1];
      if (!file) throw new Error("Missing media fixture");
      file.oursContent = "SECRET_MEDIA_BYTES";
      const report = conflictReport(snapshot, links, { ...input, mode, path: file.path });
      expect(JSON.stringify(report)).not.toContain("SECRET_MEDIA_BYTES");
      expect(report.items[0]).toMatchObject({
        links: { target: null },
        facts: { type: "modify_delete" },
        media: {
          contentInspected: false,
          referencesChecked: true,
          references: [
            { title: "Контакты", url: expect.stringContaining("branch-sha/manual/docs/") },
          ],
        },
      });
    },
  );

  it("discloses abbreviated fragments and exposes detailed and file pagination", () => {
    const snapshot = reportSnapshot();
    const section = snapshot.files[0]?.sections?.[1];
    if (section?.kind !== "conflict") throw new Error("Missing fragment");
    section.ours = "x".repeat(conflictReportLimits.excerptChars + 1);
    expect(
      firstTextItem(conflictReport(snapshot, links, input)).fragments?.[0]?.branch.truncated,
    ).toBe(true);
    const detail = conflictReport(snapshot, links, { ...input, mode: ConflictReportMode.Detailed });
    expect(firstTextItem(detail).fragments?.[0]?.branch.truncated).toBe(false);
    expect(detail.nextCursor).toBe("1");
    const first = snapshot.files[0];
    if (!first) throw new Error("Missing file");
    first.sections = Array.from({ length: 6 }, () => ({ ...section }));
    expect(firstTextItem(conflictReport(snapshot, links, input)).nextFragmentCursor).toBe("5");
    expect(
      firstTextItem(
        conflictReport(snapshot, links, { ...input, path: first.path, fragmentOffset: 5 }),
      ).fragments?.[0]?.index,
    ).toBe(5);
  });

  it("does not label unchanged branch text as an author's new edit and tolerates unsupported frontmatter", () => {
    const snapshot = reportSnapshot();
    const file = snapshot.files[0];
    if (!file) throw new Error("Missing file");
    file.oursContent = file.baseContent;
    expect(conflictReport(snapshot, links, input).items[0]?.facts.branchChanged).toBe(false);
    file.oursContent = "---\nbroken";
    expect(() => conflictReport(snapshot, links, input)).not.toThrow();
  });
});

describe("fragment resolution", () => {
  it("keeps clean stable edits when the editor chooses their branch for text conflicts", () => {
    const snapshot = reportSnapshot();
    const path = snapshot.files[0]?.path ?? "";
    expect(conflictResolutions(snapshot, [{ path, choice: "branch" }])).toEqual([
      {
        path,
        choice: BranchConflictChoice.Manual,
        content:
          "# Контакты\n\n## Фильтры\n\nВыберите список получателей.\n\nПравка ветки.\nПравка stable.\n",
      },
    ]);
  });
  it("allows more than 200 conflict fragments in one bounded text file", () => {
    const snapshot = reportSnapshot();
    const file = snapshot.files[0];
    if (!file) throw new Error("Missing fixture");
    file.sections = Array.from({ length: 201 }, () => ({
      kind: "conflict",
      base: "a\n",
      ours: "b\n",
      theirs: "c\n",
    }));
    const decisions = [
      {
        path: file.path,
        choice: "combine" as const,
        fragments: Array.from({ length: 201 }, (_, index) => ({
          index,
          choice: "branch" as const,
        })),
      },
    ];
    expect(conflictResolutionInput.safeParse(decisions).success).toBe(true);
    expect(conflictResolutions(snapshot, decisions)[0]?.content).toBe("b\n".repeat(201));
  });
  it("preserves clean edits from both branches outside the selected fragments", () => {
    const snapshot = reportSnapshot();
    const path = snapshot.files[0]?.path ?? "";
    expect(
      conflictResolutions(snapshot, [
        {
          path,
          choice: "combine",
          fragments: [{ index: 0, choice: "manual", content: "Добавьте список получателей.\n" }],
        },
      ]),
    ).toEqual([
      {
        path,
        choice: BranchConflictChoice.Manual,
        content:
          "# Контакты\n\n## Фильтры\n\nДобавьте список получателей.\n\nПравка ветки.\nПравка stable.\n",
      },
    ]);
  });
  it("rejects missing/duplicate fragment decisions and manual media, but permits explicit deletion", () => {
    const snapshot = reportSnapshot();
    const path = snapshot.files[0]?.path ?? "";
    expect(() =>
      conflictResolutions(snapshot, [{ path, choice: "combine", fragments: [] }]),
    ).toThrow("every");
    expect(() =>
      conflictResolutions(snapshot, [
        {
          path,
          choice: "combine",
          fragments: [
            { index: 0, choice: "branch" },
            { index: 0, choice: "target" },
          ],
        },
      ]),
    ).toThrow("every");
    const mediaPath = snapshot.files[1]?.path ?? "";
    expect(() => conflictResolutions(snapshot, [{ path: mediaPath, choice: "combine" }])).toThrow(
      "complete version",
    );
    expect(conflictResolutions(snapshot, [{ path: mediaPath, choice: "target" }])).toEqual([
      { path: mediaPath, choice: BranchConflictChoice.Theirs },
    ]);
  });
});
