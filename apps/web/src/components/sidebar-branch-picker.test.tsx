// @vitest-environment jsdom

import type { BranchSummary } from "@pushdocs/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey, writeDraft } from "./draft-storage";

vi.mock("@pushdocs/ui", () => ({
  SearchableSelect: ({
    footer,
    onSearchChange,
    onValueChange,
    options,
    renderOption,
  }: {
    footer: ReactNode;
    onSearchChange: (value: string) => void;
    onValueChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    renderOption: (option: { label: string; value: string }) => ReactNode;
  }) => (
    <div>
      <input
        aria-label="Поиск по веткам"
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onValueChange(option.value)}>
          {renderOption(option)}
        </button>
      ))}
      {footer}
    </div>
  ),
}));

import { SidebarBranchPicker } from "./sidebar-branch-picker";

const branches: BranchSummary[] = [
  { full_ref: "main", isCompleted: true },
  { full_ref: "current", isCompleted: true },
  { full_ref: "protected", isCompleted: true, is_protected: true },
  {
    full_ref: "merged",
    isCompleted: true,
    review: { state: "merged", externalId: "7", targetBranch: "main" },
  },
  {
    full_ref: "continued",
    isCompleted: false,
    review: { state: "merged", externalId: "8", targetBranch: "main" },
  },
  {
    full_ref: "open",
    lastCommitAt: "2026-11-15T12:00:00Z",
    review: { state: "open", externalId: "9", targetBranch: "main" },
  },
  {
    full_ref: "closed",
    isCompleted: true,
    review: { state: "closed", externalId: "10", targetBranch: "main" },
  },
];

const props = {
  branches,
  defaultBranch: "main",
  ownerId: "owner",
  projectId: "project",
  provider: "gitlab" as const,
  value: "current",
  onValueChange: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

it("hides merged and closed branches without hiding current, default or protected branches", () => {
  render(<SidebarBranchPicker {...props} />);
  expect(screen.queryByText("merged", { exact: true })).toBeNull();
  expect(screen.queryByText("closed", { exact: true })).toBeNull();
  for (const name of ["main", "current", "protected", "continued"])
    expect(screen.getByText(name, { exact: true })).toBeTruthy();
  const toggle = screen.getByRole("checkbox", { name: "Показывать влитые и закрытые (2)" });
  fireEvent.click(toggle);
  expect(screen.getByText("merged", { exact: true })).toBeTruthy();
  expect(screen.getByText("closed", { exact: true })).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByText("merged", { exact: true })).toBeNull();
  expect(screen.queryByText("closed", { exact: true })).toBeNull();
});

it("shows review states and real commit dates and preserves branch selection", () => {
  const { container } = render(<SidebarBranchPicker {...props} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("MR открыт")).toBeTruthy();
  expect(screen.getByText("MR закрыт")).toBeTruthy();
  expect(screen.getAllByText("MR влит")).toHaveLength(2);
  expect(container.querySelector("time")?.dateTime).toBe("2026-11-15T12:00:00.000Z");
  expect(screen.getAllByText("Дата недоступна").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /^open .*MR открыт/ }));
  expect(props.onValueChange).toHaveBeenCalledWith("open");
});

it("keeps the current user's browser drafts visible and updates after storage events", () => {
  writeDraft(draftKey("project", "merged", "docs/a.md", "owner"), "Changed", "Base");
  render(<SidebarBranchPicker {...props} />);
  expect(screen.getByText("merged", { exact: true })).toBeTruthy();
  localStorage.clear();
  fireEvent(window, new StorageEvent("storage"));
  expect(screen.queryByText("merged", { exact: true })).toBeNull();
});

it("does not use another user's drafts and displays PR labels for GitHub", () => {
  writeDraft(draftKey("project", "merged", "docs/a.md", "another-owner"), "Changed", "Base");
  render(<SidebarBranchPicker {...props} provider="github" />);
  expect(screen.queryByText("merged", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("PR открыт")).toBeTruthy();
  expect(screen.getByText("PR закрыт")).toBeTruthy();
});

it("shows only branches younger than a calendar year until a search is entered", () => {
  render(
    <SidebarBranchPicker
      {...props}
      branches={[
        { full_ref: "recent", lastCommitAt: "2025-11-16T12:00:00.001Z" },
        { full_ref: "year-old", lastCommitAt: "2025-11-16T12:00:00Z" },
        { full_ref: "older", lastCommitAt: "2025-11-15T12:00:00Z" },
        { full_ref: "undated" },
      ]}
    />,
  );
  expect(screen.getByText("recent", { exact: true })).toBeTruthy();
  expect(screen.getByText("undated", { exact: true })).toBeTruthy();
  expect(screen.queryByText("year-old", { exact: true })).toBeNull();
  expect(screen.queryByText("older", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByText("older", { exact: true })).toBeNull();
  const search = screen.getByRole("textbox", { name: "Поиск по веткам" });
  fireEvent.change(search, { target: { value: "older" } });
  expect(screen.getByText("older", { exact: true })).toBeTruthy();
  expect(screen.getByText("year-old", { exact: true })).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.queryByText("older", { exact: true })).toBeNull();
  expect(screen.queryByText("year-old", { exact: true })).toBeNull();
});
