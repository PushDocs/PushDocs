import type { ColumnType, Generated } from "kysely";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  created_at: GeneratedTimestamp;
  display_name: string;
  email: string;
  id: Generated<string>;
  is_instance_operator: Generated<boolean>;
  password_hash: string;
  status: Generated<"active" | "blocked">;
}

export interface SessionsTable {
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
  id: Generated<string>;
  last_seen_at: GeneratedTimestamp;
  token_hash: string;
  user_id: string;
}

export interface ProviderConnectionsTable {
  base_url: string;
  created_at: GeneratedTimestamp;
  id: Generated<string>;
  kind: "github" | "gitlab";
  name: string;
  secret_encrypted: string;
  updated_at: GeneratedTimestamp;
  vpn_profile_encrypted: string | null;
  vpn_slot: number | null;
}

export interface RepositoriesTable {
  clone_url: string;
  connection_id: string;
  created_at: GeneratedTimestamp;
  default_branch: string;
  full_name: string;
  id: Generated<string>;
  provider_repository_id: string;
}

export interface ProjectsTable {
  created_at: GeneratedTimestamp;
  default_branch: string;
  id: Generated<string>;
  name: string;
  repository_id: string;
  root_path: string;
  slug: string;
  status: Generated<"active" | "archived" | "attention">;
  updated_at: GeneratedTimestamp;
}

export interface ProjectMembershipsTable {
  created_at: GeneratedTimestamp;
  project_id: string;
  role: "admin" | "editor" | "reader";
  user_id: string;
}

export interface ProjectInvitationsTable {
  accepted_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  email: string;
  expires_at: Timestamp;
  id: Generated<string>;
  invited_by_user_id: string;
  project_id: string;
  role: "admin" | "editor" | "reader";
  token_hash: string;
}

export interface ProjectConnectionGrantsTable {
  connection_id: string;
  created_at: GeneratedTimestamp;
  project_id: string;
  repository_id: string;
}

export interface BranchContextsTable {
  is_protected: Generated<boolean>;
  repository_paths: ColumnType<string[], string | undefined, string>;
  base_commit_sha: string;
  created_at: GeneratedTimestamp;
  full_ref: string;
  generation: Generated<number>;
  head_commit_sha: string;
  id: Generated<string>;
  project_id: string;
  updated_at: GeneratedTimestamp;
}

export interface ImportedDocumentsTable {
  branch_context_id: string;
  content: string;
  content_hash: string;
  locale: string;
  path: string;
  project_id: string;
  title: string;
  updated_at: GeneratedTimestamp;
  version: string;
}

export interface PreparedGitCommit {
  branch: string;
  parentSha: string;
  sha: string;
  operationId: string;
  createdAt: string;
}

export interface ChangeSetsTable {
  prepared_commit: ColumnType<PreparedGitCommit | null, string | null | undefined, string | null>;
  base_commit_sha: string;
  branch_context_id: string;
  created_at: GeneratedTimestamp;
  id: Generated<string>;
  project_id: string;
  revision: Generated<number>;
  status: Generated<"open" | "submitting" | "submitted" | "conflicted">;
  updated_at: GeneratedTimestamp;
}

export interface DraftFilesTable {
  author_user_id: string;
  change_set_id: string;
  content: string | null;
  operation: "add" | "modify" | "delete";
  path: string;
  revision: Generated<number>;
  updated_at: GeneratedTimestamp;
}

export interface DiscussionsTable {
  anchor_quote: string | null;
  branch_context_id: string;
  created_at: GeneratedTimestamp;
  document_path: string;
  id: Generated<string>;
  project_id: string;
  resolved_at: Timestamp | null;
}

export interface CommentsTable {
  author_user_id: string;
  body: string;
  created_at: GeneratedTimestamp;
  discussion_id: string;
  id: Generated<string>;
  updated_at: GeneratedTimestamp;
}

export interface AttachmentsTable {
  change_set_id: string;
  created_at: GeneratedTimestamp;
  id: Generated<string>;
  media_type: string;
  original_name: string;
  project_id: string;
  repository_path: string;
  sha256: string;
  size_bytes: number;
  status: Generated<"pending" | "ready" | "failed">;
  storage_key: string;
}

export interface UploadLeasesTable {
  id: Generated<string>;
  project_id: string;
  branch_context_id: string;
  expires_at: Timestamp;
}

export interface ChangeSetConflictsTable {
  kind: Generated<"text" | "binary">;
  base_content: string | null;
  change_set_id: string;
  created_at: GeneratedTimestamp;
  id: Generated<string>;
  ours_content: string | null;
  path: string;
  resolved_content: string | null;
  resolution: "ours" | "theirs" | "manual" | null;
  theirs_content: string | null;
  theirs_head_sha: string;
  updated_at: GeneratedTimestamp;
}

export interface ProjectComponentsTable {
  created_at: GeneratedTimestamp;
  description: string;
  id: Generated<string>;
  label: string;
  name: string;
  project_id: string;
  snippet: string;
  source: "detected" | "manual";
  updated_at: GeneratedTimestamp;
}

export interface ChangeRequestsTable {
  external_id: string;
  head_sha: string;
  id: Generated<string>;
  project_id: string;
  provider_url: string;
  source_branch: string;
  state: "open" | "merged" | "closed";
  target_branch: string;
  title: string;
  updated_at: GeneratedTimestamp;
}

export interface CheckRunsTable {
  change_request_id: string;
  conclusion: "success" | "failure" | "neutral" | "skipped" | "running";
  duration_ms: number | null;
  external_id: string;
  id: Generated<string>;
  name: string;
  required: Generated<boolean>;
  url: string | null;
}

export interface JobsTable {
  attempts: Generated<number>;
  available_at: GeneratedTimestamp;
  created_at: GeneratedTimestamp;
  id: Generated<string>;
  kind: string;
  last_error: string | null;
  locked_at: Timestamp | null;
  payload: unknown;
  status: Generated<"queued" | "running" | "done" | "failed">;
  updated_at: GeneratedTimestamp;
}

export interface DomainEventsTable {
  created_at: GeneratedTimestamp;
  entity_id: string;
  id: Generated<string>;
  payload: unknown;
  project_id: string | null;
  recipient_user_id: string | null;
  revision: number;
  sequence: number;
  type: string;
}

export interface InstanceStateTable {
  event_counter: number;
  singleton: boolean;
}

export interface Database {
  upload_leases: UploadLeasesTable;
  preview_builds: {
    id: Generated<string>;
    project_id: string;
    branch: string;
    sha: string;
    revision: number;
    snapshot: unknown;
    status: Generated<"queued" | "building" | "ready" | "failed">;
    log: Generated<string>;
    created_at: GeneratedTimestamp;
    updated_at: GeneratedTimestamp;
  };
  attachments: AttachmentsTable;
  branch_contexts: BranchContextsTable;
  change_requests: ChangeRequestsTable;
  change_set_conflicts: ChangeSetConflictsTable;
  change_sets: ChangeSetsTable;
  check_runs: CheckRunsTable;
  comments: CommentsTable;
  discussions: DiscussionsTable;
  domain_events: DomainEventsTable;
  draft_files: DraftFilesTable;
  imported_documents: ImportedDocumentsTable;
  instance_state: InstanceStateTable;
  jobs: JobsTable;
  project_connection_grants: ProjectConnectionGrantsTable;
  project_components: ProjectComponentsTable;
  project_invitations: ProjectInvitationsTable;
  project_memberships: ProjectMembershipsTable;
  projects: ProjectsTable;
  provider_connections: ProviderConnectionsTable;
  repositories: RepositoriesTable;
  sessions: SessionsTable;
  users: UsersTable;
}
