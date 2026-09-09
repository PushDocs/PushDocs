# PushDocs

PushDocs is a self-hosted CMS for Docusaurus projects stored in GitHub or GitLab. One installation supports several projects. Users have an independent administrator, editor, or reader role in each project.

The application uses this hierarchy:

```text
Installation -> Projects -> Branches -> Documents
```

## Implemented features

The repository contains a working MVP:

- The first operator creates the installation and can add encrypted GitHub or GitLab connections.
- One installation can import and manage several projects. Each project has its own members and roles.
- The worker imports the default branch and discovers every remote branch. A user can load another branch without replacing the active branch context.
- Editors can create and edit Markdown or MDX documents. Drafts use revision checks and autosave to prevent one browser tab from silently overwriting another.
- Editors can upload images and PDF files. PushDocs includes documents and attachments in one commit.
- Readers can comment on documents. Comment and status updates reach open pages through server-sent events.
- Editors can send a change set to GitHub or GitLab and create a pull request or merge request. Native Git uses an exact branch lease during the push, and a persistent prepared-commit journal makes interrupted submissions retryable without duplicate commits.
- If the remote branch changes in the same files, PushDocs records a three-way conflict and provides a text conflict editor.
- The review screen displays open pull requests or merge requests and their current checks.
- A project can register custom MDX components. The editor inserts their configured source snippets and shows safe placeholders in preview.
- The document workbench has a file tree, persisted and closeable tabs, content search, language/version/status filters, highlighted MDX source with line numbers, scalar metadata forms, quick Markdown preview, and side-by-side comparison. It preserves untouched MDX bytes and line endings when editing.
- Administrators can create and edit `.pushdocs/config.json` in the workbench. The configuration defines document roots, editable technical files, document templates with companion files, media paths and preview commands. It contains no repository-specific rules in application code.
- The media library lists existing Git files and uploads, supports drag and drop, progress, cancellation, retry, deletion and link insertion. Uploads require explicit replacement of existing files. Limits are 64 MiB per file, 256 MiB per submission and four active uploads per project.
- An optional preview runner builds the actual Docusaurus site from an immutable Git SHA with staged text and binary files. A preview does not create a commit or MR.

The web application and the regular worker do not execute repository JavaScript. Quick preview renders Markdown without executing MDX. Only the optional, isolated preview build container executes the site's components and plugins.

## Current limits

- PushDocs displays provider checks, but merging still happens in GitHub or GitLab.
- Comments are stored in PushDocs and are not copied to provider discussions.
- Review state is refreshed every 30 seconds. Provider webhooks are not implemented yet.
- The write path has real local Git and PostgreSQL integration tests. Live provider acceptance requires separately agreed test repositories. Tests never push to sendsay-docs.
- The updated development plan is only partially implemented. Merge/rebase, provider discussions, structural conflicts, navigation editing and component property forms remain open. Binary conflicts currently offer the Git version or the saved upload, not a third replacement upload.
- Preview is experimental and opt-in. Operators can grant runtime profiles to individual projects and must prepare an offline dependency cache. The queue permits two active builds per project. Completed outputs expire after seven days, with up to three successful results per branch. Automated private-dependency preparation and installation-wide disk quotas remain open.

## Run with Docker Compose

Create production secrets before exposing the service:

~~~sh
export PUSHDOCS_SESSION_PEPPER="$(openssl rand -hex 32)"
export PUSHDOCS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker compose up --build
~~~

Open `http://localhost:8080` and create the first operator. Add a Git connection, then connect a Docusaurus project. You can paste a repository URL, a GitLab numeric project ID, a GitLab namespace and path, or a GitHub owner and repository name. The worker imports the default branch in the background.

The defaults in `compose.yml` are for local evaluation only. A production deployment must provide both secrets and a strong PostgreSQL password.

## Local development

Start PostgreSQL, copy `.env.example` to `.env`, and replace the secrets. Then run:

~~~sh
yarn install
yarn db:migrate
yarn dev:all
~~~

The web application listens on port 3000, and the realtime process listens on port 4100.
Set `PUSHDOCS_REALTIME_ORIGIN=http://127.0.0.1:4100` for direct local development. Compose routes `/events` through Caddy. Set `PUSHDOCS_PUBLIC_ORIGIN` to the exact public CMS origin when using a reverse proxy.

## Exact draft preview

The optional [preview setup guide](development/preview.md) explains the runtime image, offline dependencies, separate domain and Compose overlay. Do not enable the Docker runner on a shared production host for untrusted repositories.

The editor's **Конфигурация проекта** button creates or opens the versioned configuration. Saving it stages a draft; it does not commit the file. Templates show their complete list of files before applying. Unsupported navigation and configuration formats remain source files, not executable CMS extensions.

## Checks

GitHub Actions runs the ADR checks and publishes tested Docker images after pushes to `stable` or version tags. See [CI and container delivery](docs/ci-cd.md) for the required check, image digests, local smoke tests and release procedure.

~~~sh
yarn test
yarn test:coverage
yarn check
~~~

`yarn test:integration` requires `PUSHDOCS_TEST_DATABASE_URL` pointing to a dedicated local PostgreSQL server whose user can create databases. It creates and removes its own random test database and temporary Git repositories. It refuses non-local database hosts and never reads the application's provider connections. See [the verification report](docs/verification-2026-09-08.md) for the tested scenarios and remaining limits.

The coverage check includes domain rules, content import, provider adapters, database repositories, server actions, background services, and shared interface components. It requires 100 percent line coverage, 99 percent statement and function coverage, and 95 percent branch coverage. Current coverage is below those thresholds; the measurements and manual CI option are documented in [CI and container delivery](docs/ci-cd.md).

Architecture decisions are in [the ADR](docs/adr/0001-pushdocs-architecture.md). Compatibility notes for sendsay-docs are in [the import report](docs/compatibility/sendsay-docs.md).

The [development plan](docs/development-plan.md) separates delivered capabilities from remaining work. The [verification report](docs/verification-2026-09-08.md) records automated checks, browser scenarios and limits of the compatibility claims.
