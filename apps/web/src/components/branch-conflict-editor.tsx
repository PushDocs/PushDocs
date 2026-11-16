"use client";

import {
  BranchConflictChoice,
  type BranchConflictFile,
  type BranchConflictResolution,
  type BranchConflictSection,
  branchConflictLimits,
} from "@pushdocs/contracts";
import { LoaderCircle } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { buildTextDiff, type DiffLine } from "./text-diff";

type FragmentDecision = { choice?: BranchConflictChoice; content?: string };
export type FragmentChoices = Record<number, FragmentDecision>;
export type ConflictDrafts = Record<string, FragmentChoices>;
type ConflictSection = Extract<BranchConflictSection, { kind: "conflict" }>;
const contextLines = 3;

function chosenText(section: ConflictSection, decision?: FragmentDecision) {
  return decision?.choice === BranchConflictChoice.Ours
    ? section.ours
    : decision?.choice === BranchConflictChoice.Theirs
      ? section.theirs
      : decision?.choice === BranchConflictChoice.Manual
        ? decision.content
        : undefined;
}

export function resolveConflictSections(
  file: BranchConflictFile,
  choices: FragmentChoices,
): BranchConflictResolution[number] | undefined {
  if (!file.sections) return;
  let content = "";
  for (const [index, section] of file.sections.entries()) {
    const text = section.kind === "text" ? section.content : chosenText(section, choices[index]);
    if (text === undefined) return;
    content += text;
  }
  return { path: file.path, choice: BranchConflictChoice.Manual, content };
}

function SourceLines({
  text,
  kind = "context",
  highlightStart,
  highlightEnd,
  discarded,
}: {
  text: string;
  kind?: "context" | "add" | "delete";
  highlightStart?: boolean;
  highlightEnd?: boolean;
  discarded?: boolean;
}) {
  const lines = [...text.matchAll(/[^\n]*\n|[^\n]+$/g)];
  return lines.map((line, index) => (
    <div
      className="conflict-source-line"
      data-kind={kind}
      data-discarded={discarded}
      data-context={Boolean(
        (highlightStart && index < contextLines) ||
          (highlightEnd && index >= lines.length - contextLines),
      )}
      key={line.index}
    >
      <span aria-hidden>{kind === "add" ? "+" : kind === "delete" ? "−" : " "}</span>
      <code>{line[0].replace(/\r?\n$/, "") || " "}</code>
    </div>
  ));
}

function contextText(section: BranchConflictSection | undefined, before = false) {
  if (section?.kind !== "text") return "";
  const lines = section.content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return (before ? lines.slice(-contextLines) : lines.slice(0, contextLines)).join("");
}

function ConflictDiffBlock({
  kind,
  discarded,
  branch,
  children,
}: {
  kind: DiffLine["kind"];
  discarded: boolean;
  branch: string;
  children: ReactNode;
}) {
  return discarded ? (
    <details className="conflict-diff-block" data-kind={kind} data-discarded="true">
      <summary>Не используется · {branch}</summary>
      <div className="conflict-diff-discarded-content">{children}</div>
    </details>
  ) : (
    <div className="conflict-diff-block" data-kind={kind} data-discarded="false">
      {children}
    </div>
  );
}

function ConflictComparison({
  section,
  branch,
  targetBranch,
  choice,
  manualContent,
  before = "",
  after = "",
}: {
  section: ConflictSection;
  branch: string;
  targetBranch: string;
  choice?: BranchConflictChoice;
  manualContent?: string;
  before?: string;
  after?: string;
}) {
  const blocks = useMemo(() => {
    const diff = buildTextDiff(section.ours, section.theirs);
    if (!diff) return null;
    const groups: { kind: DiffLine["kind"]; lines: DiffLine[] }[] = [];
    for (const line of diff.lines) {
      const previous = groups.at(-1);
      if (previous?.kind === line.kind) previous.lines.push(line);
      else groups.push({ kind: line.kind, lines: [line] });
    }
    return groups;
  }, [section.ours, section.theirs]);
  const discardOurs = Boolean(choice && choice !== BranchConflictChoice.Ours);
  const discardTheirs = Boolean(choice && choice !== BranchConflictChoice.Theirs);
  return (
    <div className="branch-conflict-diff">
      <div className="conflict-diff-legend">
        <span data-kind="delete" data-discarded={discardOurs}>
          − Ваш текст · {branch}
          {choice ? (discardOurs ? " · Не используется" : " · Выбрано") : ""}
        </span>
        <span data-kind="add" data-discarded={discardTheirs}>
          + Другой вариант · {targetBranch}
          {choice ? (discardTheirs ? " · Не используется" : " · Выбрано") : ""}
        </span>
      </div>
      <SourceLines text={before} highlightEnd />
      <div className="conflict-diff-changes">
        {blocks ? (
          blocks.map((block) => (
            <ConflictDiffBlock
              kind={block.kind}
              discarded={
                block.kind === "delete" ? discardOurs : block.kind === "add" ? discardTheirs : false
              }
              branch={block.kind === "delete" ? branch : targetBranch}
              key={`${block.lines[0]?.id}:${choice ?? "unresolved"}`}
            >
              {block.lines.map((line) => (
                <div className="conflict-source-line" key={line.id}>
                  <span aria-hidden>
                    {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}
                  </span>
                  <code>{line.text || " "}</code>
                </div>
              ))}
            </ConflictDiffBlock>
          ))
        ) : (
          <>
            <ConflictDiffBlock
              kind="delete"
              discarded={discardOurs}
              branch={branch}
              key={`ours:${choice}`}
            >
              <SourceLines text={section.ours} kind="delete" />
            </ConflictDiffBlock>
            <ConflictDiffBlock
              kind="add"
              discarded={discardTheirs}
              branch={targetBranch}
              key={`theirs:${choice}`}
            >
              <SourceLines text={section.theirs} kind="add" />
            </ConflictDiffBlock>
          </>
        )}
        {!section.ours || !section.theirs ? (
          <p className="conflict-empty-text">
            {!section.ours
              ? "В вашем варианте этот фрагмент удалён."
              : "В другом варианте этот фрагмент удалён."}
          </p>
        ) : null}
        {choice === BranchConflictChoice.Manual ? (
          <section className="conflict-diff-manual" aria-label="Свой вариант в сравнении">
            {manualContent ? (
              <SourceLines text={manualContent} />
            ) : (
              <p className="conflict-empty-text">Этот фрагмент будет удалён.</p>
            )}
          </section>
        ) : null}
      </div>
      <SourceLines text={after} highlightStart />
    </div>
  );
}

export function BranchConflictEditor({
  file,
  branch,
  targetBranch,
  value,
  fragments = {},
  onChange,
  onRefresh,
  refreshing = false,
}: {
  file: BranchConflictFile;
  branch: string;
  targetBranch: string;
  value?: BranchConflictResolution[number];
  fragments?: FragmentChoices;
  onChange: (
    value: BranchConflictResolution[number] | undefined,
    fragments?: FragmentChoices,
  ) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const sections = file.sections;
  const conflicts = sections?.flatMap((section, index) =>
    section.kind === "conflict" ? [{ section, index }] : [],
  );
  const remaining = conflicts?.filter(({ index }) => !fragments[index]?.choice).length ?? 0;
  const legacy = value && !Object.keys(fragments).length;

  function choose(index: number, decision: FragmentDecision) {
    const next = { ...fragments, [index]: decision };
    onChange(resolveConflictSections(file, next), next);
  }

  if (file.kind === "text" && file.oursExists && file.theirsExists && !conflicts?.length)
    return (
      <div className="panel-note">
        <p>Обновите данные, чтобы увидеть только спорные фрагменты документа.</p>
        <button
          type="button"
          className="pd-button pd-button--secondary"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? <LoaderCircle className="spin" size={16} aria-hidden /> : null}
          Обновить список конфликтов
        </button>
      </div>
    );

  return (
    <div className="conflict-editor wb-diff">
      {conflicts?.length ? (
        <>
          <p className="conflict-fragment-progress" role="status">
            {legacy
              ? "Сохранено решение для всего документа. Можно изменить его по фрагментам ниже."
              : remaining
                ? `Осталось выбрать: ${remaining} из ${conflicts.length}`
                : "Все фрагменты решены"}
          </p>
          {conflicts.map(({ section, index }, number) => {
            const selected = fragments[index];
            const name = `${file.path}:${index}`;
            return (
              <fieldset className="conflict-fragment" key={index}>
                <legend>
                  Фрагмент {number + 1} из {conflicts.length}
                  {selected?.choice ? " · Готово" : " · Выберите текст"}
                </legend>
                <ConflictComparison
                  section={section}
                  branch={branch}
                  targetBranch={targetBranch}
                  choice={selected?.choice}
                  manualContent={selected?.content}
                  before={contextText(sections?.[index - 1], true)}
                  after={contextText(sections?.[index + 1])}
                />
                <div className="conflict-fragment-choices">
                  {[
                    { choice: BranchConflictChoice.Ours, label: "Оставить ваш текст" },
                    { choice: BranchConflictChoice.Theirs, label: `Откатить до ${targetBranch}` },
                    { choice: BranchConflictChoice.Manual, label: "Свой текст" },
                  ].map((option) => (
                    <label data-selected={selected?.choice === option.choice} key={option.choice}>
                      <input
                        type="radio"
                        name={name}
                        checked={selected?.choice === option.choice}
                        onClick={() => {
                          if (selected?.choice === option.choice)
                            choose(index, { content: selected.content });
                        }}
                        onChange={() =>
                          choose(index, {
                            choice: option.choice,
                            content:
                              selected?.content ??
                              (option.choice === BranchConflictChoice.Manual
                                ? (chosenText(section, selected) ?? section.ours)
                                : undefined),
                          })
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {selected?.choice === BranchConflictChoice.Manual ? (
                  <div className="conflict-fragment-manual">
                    <p id={`hint:${name}`}>
                      Заменит выделенный фрагмент выше. Текст вокруг сохранится без изменений.
                    </p>
                    <textarea
                      id={`result:${name}`}
                      aria-label={`Свой текст: ${file.path}, фрагмент ${number + 1}`}
                      aria-describedby={`hint:${name}`}
                      value={selected.content ?? ""}
                      maxLength={branchConflictLimits.textBytes}
                      rows={Math.min(
                        12,
                        Math.max(3, (selected.content?.split("\n").length ?? 1) + 1),
                      )}
                      onChange={(event) =>
                        choose(index, {
                          choice: BranchConflictChoice.Manual,
                          content: event.target.value,
                        })
                      }
                    />
                  </div>
                ) : null}
              </fieldset>
            );
          })}
        </>
      ) : (
        <>
          <p>
            {file.kind === "text"
              ? "В одной ветке документ удалён, а в другой изменён. Выберите, сохранить его или удалить."
              : "Для этого файла нужно выбрать одну из двух версий."}
          </p>
          <div className="conflict-file-options">
            {[
              { choice: BranchConflictChoice.Ours, exists: file.oursExists, branch },
              {
                choice: BranchConflictChoice.Theirs,
                exists: file.theirsExists,
                branch: targetBranch,
              },
            ].map((side) => (
              <label key={side.choice}>
                <input
                  type="radio"
                  name={file.path}
                  checked={value?.choice === side.choice}
                  onClick={() => {
                    if (value?.choice === side.choice) onChange(undefined);
                  }}
                  onChange={() => onChange({ path: file.path, choice: side.choice })}
                />
                {side.exists
                  ? `Сохранить версию из ${side.branch}`
                  : `Удалить документ, как в ${side.branch}`}
              </label>
            ))}
          </div>
        </>
      )}
      {file.kind === "text" ? (
        <details className="conflict-document-preview">
          <summary>Посмотреть документ целиком</summary>
          <h3>{legacy || !remaining ? "Итоговый документ" : "Предварительный результат"}</h3>
          {!legacy && conflicts?.length ? (
            <p className="conflict-document-explanation">
              {remaining
                ? `Выбранные решения применены. В нерешённых фрагментах (${remaining}) пока показан текст из вашей ветки ${branch}. Остальные изменения объединены автоматически.`
                : `Все выбранные решения применены. Этот документ будет отправлен в ${branch}.`}
            </p>
          ) : null}
          {legacy && value.choice === BranchConflictChoice.Manual ? (
            <>
              <p>Сохранённый итоговый документ</p>
              <textarea
                aria-label={`Итог ${file.path}`}
                value={value.content ?? ""}
                maxLength={branchConflictLimits.textBytes}
                onChange={(event) =>
                  onChange({
                    path: file.path,
                    choice: BranchConflictChoice.Manual,
                    content: event.target.value,
                  })
                }
              />
            </>
          ) : legacy ? (
            <>
              <p>
                Сохранена версия документа из{" "}
                {value.choice === BranchConflictChoice.Ours ? branch : targetBranch}.
              </p>
              <pre>
                {value.choice === BranchConflictChoice.Ours ? file.oursContent : file.theirsContent}
              </pre>
            </>
          ) : sections ? (
            <div className="conflict-document-source">
              {sections.map((section, index) => {
                const sectionKey = `${section.kind}:${index}`;
                if (section.kind === "text")
                  return (
                    <SourceLines
                      text={section.content}
                      highlightStart={sections[index - 1]?.kind === "conflict"}
                      highlightEnd={sections[index + 1]?.kind === "conflict"}
                      key={sectionKey}
                    />
                  );
                const number = conflicts?.findIndex((item) => item.index === index) ?? 0;
                const decision = fragments[index];
                const text = chosenText(section, decision) ?? section.ours;
                return (
                  <section
                    className="conflict-document-highlight"
                    data-choice={decision?.choice}
                    aria-label={`Фрагмент ${number + 1} в документе`}
                    key={sectionKey}
                  >
                    <h4>
                      Фрагмент {number + 1}
                      {decision?.choice ? " · Выбранный текст" : ` · Пока из вашей ветки ${branch}`}
                    </h4>
                    {text ? (
                      <SourceLines
                        text={text}
                        kind={decision?.choice ? "add" : "context"}
                        highlightStart={!decision?.choice}
                        highlightEnd={!decision?.choice}
                      />
                    ) : (
                      <p>Фрагмент удалён</p>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <>
              <h4>Ваш текст · {branch}</h4>
              <pre>{file.oursExists ? file.oursContent : "Документ удалён"}</pre>
              <h4>Другой вариант · {targetBranch}</h4>
              <pre>{file.theirsExists ? file.theirsContent : "Документ удалён"}</pre>
            </>
          )}
        </details>
      ) : null}
    </div>
  );
}
