import { z } from "zod";

export const roleSchema = z.enum(["admin", "editor", "reader"]);
export type ProjectRole = z.infer<typeof roleSchema>;

export const providerKindSchema = z.enum(["github", "gitlab"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const bootstrapSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
});

export const loginSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const acceptInvitationSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(200),
  token: z.string().min(20).max(200),
});

export const createProjectSchema = z.object({
  connectionId: z.uuid(),
  defaultBranch: z.string().trim().max(255).optional(),
  name: z.string().trim().min(2).max(120),
  repositoryProviderId: z.string().trim().min(1).max(300),
  rootPath: z.string().trim().max(500).default("."),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const createConnectionSchema = z.object({
  baseUrl: z.url(),
  kind: providerKindSchema,
  name: z.string().trim().min(2).max(100),
  token: z.string().min(1).max(4000),
});

export const saveDraftSchema = z.object({
  baseCommitSha: z.string().trim().min(7).max(64),
  branch: z.string().trim().min(1).max(255),
  content: z.string().max(5_000_000),
  expectedRevision: z.number().int().nonnegative(),
  path: z.string().trim().min(1).max(1000),
});

export const createCommentSchema = z.object({
  anchorQuote: z.string().max(1000).nullable().default(null),
  body: z.string().trim().min(1).max(20_000),
  branch: z.string().trim().min(1).max(255),
  documentPath: z.string().trim().min(1).max(1000),
});

export const inviteMemberSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: roleSchema,
});

export const submitChangeSetSchema = z.object({
  branch: z.string().trim().min(1).max(255),
  changeSetId: z.uuid(),
  createReview: z.boolean(),
  message: z.string().trim().min(3).max(5000),
  projectId: z.uuid(),
});

export const resolveConflictSchema = z.object({
  conflictId: z.uuid(),
  projectId: z.uuid(),
  resolution: z.enum(["ours", "theirs", "manual"]),
  resolvedContent: z.string().max(5_000_000),
});

export const createComponentSchema = z.object({
  description: z.string().trim().max(500).default(""),
  label: z.string().trim().min(1).max(100),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*)*$/),
  snippet: z.string().trim().min(4).max(20_000),
});

export const createDocumentSchema = z.object({
  branch: z.string().trim().min(1).max(255),
  path: z
    .string()
    .trim()
    .min(4)
    .max(1000)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+\.mdx?$/i),
  title: z.string().trim().min(1).max(300),
});

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ProjectSummary {
  defaultBranch: string;
  id: string;
  name: string;
  openChangeRequests: number;
  provider: ProviderKind;
  providerLabel: string;
  role: ProjectRole;
  slug: string;
  syncStatus: "current" | "syncing" | "attention";
  updatedAt: string;
}

export interface DocumentSummary {
  path: string;
  title: string;
  locale: string;
  version: string;
  status: "clean" | "modified" | "added" | "deleted";
}

export interface CheckRunSummary {
  conclusion: "success" | "failure" | "neutral" | "skipped" | "running";
  durationMs: number | null;
  id: string;
  name: string;
  required: boolean;
  url: string | null;
}
