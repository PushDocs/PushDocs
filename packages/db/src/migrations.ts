import { type Kysely, type Migration, Migrator, sql } from "kysely";
import type { Database } from "./schema";

const initialMigration: Migration = {
  async up(db) {
    await sql`create extension if not exists pgcrypto`.execute(db);
    await sql`
      create table users (
        id uuid primary key default gen_random_uuid(),
        email text not null unique,
        display_name text not null,
        password_hash text not null,
        is_instance_operator boolean not null default false,
        status text not null default 'active' check (status in ('active', 'blocked')),
        created_at timestamptz not null default now()
      );
      create table sessions (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );
      create index sessions_user_id_idx on sessions(user_id);

      create table provider_connections (
        id uuid primary key default gen_random_uuid(),
        name text not null unique,
        kind text not null check (kind in ('github', 'gitlab')),
        base_url text not null,
        secret_encrypted text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table repositories (
        id uuid primary key default gen_random_uuid(),
        connection_id uuid not null references provider_connections(id) on delete restrict,
        provider_repository_id text not null,
        full_name text not null,
        clone_url text not null,
        default_branch text not null,
        created_at timestamptz not null default now(),
        unique(connection_id, provider_repository_id)
      );
      create table projects (
        id uuid primary key default gen_random_uuid(),
        repository_id uuid not null references repositories(id) on delete restrict,
        slug text not null unique,
        name text not null,
        root_path text not null default '.',
        default_branch text not null,
        status text not null default 'active' check (status in ('active', 'archived', 'attention')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table project_memberships (
        project_id uuid not null references projects(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        role text not null check (role in ('admin', 'editor', 'reader')),
        created_at timestamptz not null default now(),
        primary key(project_id, user_id)
      );
      create table project_invitations (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        email text not null,
        role text not null check (role in ('admin', 'editor', 'reader')),
        token_hash text not null unique,
        invited_by_user_id uuid not null references users(id) on delete restrict,
        expires_at timestamptz not null,
        accepted_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table project_connection_grants (
        project_id uuid not null references projects(id) on delete cascade,
        connection_id uuid not null references provider_connections(id) on delete restrict,
        repository_id uuid not null references repositories(id) on delete restrict,
        created_at timestamptz not null default now(),
        primary key(project_id, connection_id, repository_id)
      );
      create table branch_contexts (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        full_ref text not null,
        generation integer not null default 1,
        head_commit_sha text not null,
        base_commit_sha text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(project_id, full_ref, generation)
      );
      create table imported_documents (
        project_id uuid not null references projects(id) on delete cascade,
        branch_context_id uuid not null references branch_contexts(id) on delete cascade,
        path text not null,
        title text not null,
        locale text not null default 'ru',
        version text not null default 'current',
        content text not null,
        content_hash text not null,
        updated_at timestamptz not null default now(),
        primary key(branch_context_id, path)
      );
      create table change_sets (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        branch_context_id uuid not null references branch_contexts(id) on delete cascade,
        base_commit_sha text not null,
        revision integer not null default 0,
        status text not null default 'open' check (status in ('open', 'submitting', 'submitted', 'conflicted')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create unique index one_open_change_set_per_branch
        on change_sets(branch_context_id) where status in ('open', 'submitting', 'conflicted');
      create table draft_files (
        change_set_id uuid not null references change_sets(id) on delete cascade,
        path text not null,
        operation text not null check (operation in ('add', 'modify', 'delete')),
        content text,
        author_user_id uuid not null references users(id) on delete restrict,
        revision integer not null default 1,
        updated_at timestamptz not null default now(),
        primary key(change_set_id, path)
      );
      create table discussions (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        branch_context_id uuid not null references branch_contexts(id) on delete cascade,
        document_path text not null,
        anchor_quote text,
        resolved_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table comments (
        id uuid primary key default gen_random_uuid(),
        discussion_id uuid not null references discussions(id) on delete cascade,
        author_user_id uuid not null references users(id) on delete restrict,
        body text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table attachments (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        change_set_id uuid not null references change_sets(id) on delete cascade,
        original_name text not null,
        storage_key text not null unique,
        media_type text not null,
        size_bytes bigint not null,
        sha256 text not null,
        status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
        created_at timestamptz not null default now()
      );
      create table change_requests (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        external_id text not null,
        title text not null,
        source_branch text not null,
        target_branch text not null,
        head_sha text not null,
        state text not null check (state in ('open', 'merged', 'closed')),
        provider_url text not null,
        updated_at timestamptz not null default now(),
        unique(project_id, external_id)
      );
      create table check_runs (
        id uuid primary key default gen_random_uuid(),
        change_request_id uuid not null references change_requests(id) on delete cascade,
        external_id text not null,
        name text not null,
        conclusion text not null check (conclusion in ('success', 'failure', 'neutral', 'skipped', 'running')),
        required boolean not null default false,
        duration_ms integer,
        url text,
        unique(change_request_id, external_id)
      );
      create table jobs (
        id uuid primary key default gen_random_uuid(),
        kind text not null,
        payload jsonb not null,
        status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
        attempts integer not null default 0,
        available_at timestamptz not null default now(),
        locked_at timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index jobs_queue_idx on jobs(status, available_at);
      create table instance_state (
        singleton boolean primary key default true check(singleton),
        event_counter bigint not null default 0
      );
      insert into instance_state(singleton) values (true);
      create table domain_events (
        id uuid primary key default gen_random_uuid(),
        sequence bigint not null unique,
        project_id uuid references projects(id) on delete cascade,
        recipient_user_id uuid references users(id) on delete cascade,
        type text not null,
        entity_id text not null,
        revision integer not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        check(project_id is not null or recipient_user_id is not null)
      );
      create index domain_events_project_sequence_idx on domain_events(project_id, sequence);
      create index domain_events_recipient_sequence_idx on domain_events(recipient_user_id, sequence);
    `.execute(db);
  },
  async down(db) {
    await sql`
      drop table if exists domain_events, instance_state, jobs, check_runs, change_requests,
        attachments, comments, discussions, draft_files, change_sets, imported_documents,
        branch_contexts, project_connection_grants, project_invitations, project_memberships,
        projects, repositories, provider_connections, sessions, users cascade
    `.execute(db);
  },
};

const conflictResolutionMigration: Migration = {
  async up(db) {
    await sql`
      alter table attachments add column repository_path text not null default '';
      create table change_set_conflicts (
        id uuid primary key default gen_random_uuid(),
        change_set_id uuid not null references change_sets(id) on delete cascade,
        path text not null,
        base_content text,
        ours_content text,
        theirs_content text,
        theirs_head_sha text not null,
        resolution text check (resolution in ('ours', 'theirs', 'manual')),
        resolved_content text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(change_set_id, path)
      );
    `.execute(db);
  },
  async down(db) {
    await sql`
      drop table if exists change_set_conflicts;
      alter table attachments drop column if exists repository_path;
    `.execute(db);
  },
};

const componentCatalogMigration: Migration = {
  async up(db) {
    await sql`
      create table project_components (
        id uuid primary key default gen_random_uuid(),
        project_id uuid not null references projects(id) on delete cascade,
        name text not null,
        label text not null,
        description text not null default '',
        snippet text not null,
        source text not null check (source in ('detected', 'manual')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(project_id, name)
      );
    `.execute(db);
  },
  async down(db) {
    await sql`drop table if exists project_components`.execute(db);
  },
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        return {
          "001-initial": initialMigration,
          "002-conflict-resolution": conflictResolutionMigration,
          "003-component-catalog": componentCatalogMigration,
          "004-repository-paths": {
            async up(database) {
              await sql`alter table branch_contexts add column repository_paths jsonb not null default '[]'::jsonb`.execute(
                database,
              );
            },
            async down(database) {
              await sql`alter table branch_contexts drop column repository_paths`.execute(database);
            },
          },
          "006-prepared-commits": {
            async up(database) {
              await sql`alter table change_sets add column prepared_commit jsonb`.execute(database);
            },
            async down(database) {
              await sql`alter table change_sets drop column prepared_commit`.execute(database);
            },
          },
          "007-binary-conflicts": {
            async up(database) {
              await sql`alter table change_set_conflicts add column kind text not null default 'text' check (kind in ('text', 'binary'))`.execute(
                database,
              );
            },
            async down(database) {
              await sql`alter table change_set_conflicts drop column kind`.execute(database);
            },
          },
          "008-upload-leases": {
            async up(database) {
              await sql`create table upload_leases (
                id uuid primary key default gen_random_uuid(),
                project_id uuid not null references projects(id) on delete cascade,
                branch_context_id uuid not null references branch_contexts(id) on delete cascade,
                expires_at timestamptz not null
              )`.execute(database);
              await sql`create index upload_leases_branch_idx on upload_leases(branch_context_id, expires_at)`.execute(
                database,
              );
            },
            async down(database) {
              await sql`drop table upload_leases`.execute(database);
            },
          },
          "009-branch-protection": {
            async up(database) {
              await sql`alter table branch_contexts add column is_protected boolean not null default false`.execute(
                database,
              );
            },
            async down(database) {
              await sql`alter table branch_contexts drop column is_protected`.execute(database);
            },
          },
          "010-connection-vpn": {
            async up(database) {
              await sql`
                alter table provider_connections
                  add column vpn_profile_encrypted text,
                  add column vpn_slot integer unique check (vpn_slot between 1 and 4),
                  add constraint provider_connections_vpn_pair
                    check ((vpn_profile_encrypted is null) = (vpn_slot is null))
              `.execute(database);
            },
            async down(database) {
              await sql`
                alter table provider_connections
                  drop constraint provider_connections_vpn_pair,
                  drop column vpn_slot,
                  drop column vpn_profile_encrypted
              `.execute(database);
            },
          },
          "005-preview-builds": {
            async up(database) {
              await sql`create table preview_builds (
                id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade,
                branch text not null, sha text not null, revision integer not null, snapshot jsonb not null,
                status text not null default 'queued' check (status in ('queued','building','ready','failed')),
                log text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
              )`.execute(database);
              await sql`create index preview_builds_project_idx on preview_builds(project_id, created_at)`.execute(
                database,
              );
            },
            async down(database) {
              await database.schema.dropTable("preview_builds").execute();
            },
          },
        };
      },
    },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    console.log(`${result.migrationName}: ${result.status}`);
  }
  if (error) throw error;
}
