import type { CheckRunSummary, ProjectRole } from "@pushdocs/contracts";

export type ProjectAction =
  | "project:read"
  | "comment:create"
  | "comment:moderate"
  | "document:write"
  | "branch:push"
  | "change-request:create"
  | "change-request:merge"
  | "member:manage"
  | "project:configure";

const permissions: Record<ProjectRole, ReadonlySet<ProjectAction>> = {
  admin: new Set([
    "project:read",
    "comment:create",
    "comment:moderate",
    "document:write",
    "branch:push",
    "change-request:create",
    "change-request:merge",
    "member:manage",
    "project:configure",
  ]),
  editor: new Set([
    "project:read",
    "comment:create",
    "document:write",
    "branch:push",
    "change-request:create",
  ]),
  reader: new Set(["project:read", "comment:create"]),
};

export class AccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED";

  constructor(action: ProjectAction) {
    super(`The project role does not allow ${action}`);
  }
}

export function can(role: ProjectRole, action: ProjectAction): boolean {
  return permissions[role].has(action);
}

export function assertCan(role: ProjectRole, action: ProjectAction): void {
  if (!can(role, action)) throw new AccessDeniedError(action);
}

export function normalizeBranchRef(value: string): string {
  const branch = value.trim();
  const forbiddenCharacters = new Set(["~", "^", ":", "?", "*", "[", "\\"]);
  const hasForbiddenCharacter = [...branch].some(
    (character) =>
      forbiddenCharacters.has(character) ||
      character.charCodeAt(0) <= 32 ||
      character.charCodeAt(0) === 127,
  );
  if (
    branch.length === 0 ||
    branch.length > 255 ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    hasForbiddenCharacter
  ) {
    throw new Error("Invalid Git branch name");
  }
  return branch;
}

export interface MergeReadiness {
  blockingFailures: CheckRunSummary[];
  pending: CheckRunSummary[];
  ready: boolean;
}

export function evaluateMergeReadiness(checks: CheckRunSummary[]): MergeReadiness {
  const blockingFailures = checks.filter(
    (check) => check.required && check.conclusion === "failure",
  );
  const pending = checks.filter((check) => check.required && check.conclusion === "running");
  return {
    blockingFailures,
    pending,
    ready: blockingFailures.length === 0 && pending.length === 0,
  };
}
