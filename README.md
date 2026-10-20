# PushDocs

PushDocs is a self-hosted CMS for Docusaurus projects stored in GitHub or GitLab. One installation supports several projects. Users have an independent administrator, editor, or reader role in each project.

The application uses this hierarchy:

```text
Installation -> Projects -> Branches -> Documents
```

## Implemented features

The repository contains a working MVP:

- The first operator creates the installation and can add encrypted GitHub or GitLab connections.
- New operators and invited users must connect a TOTP authenticator before accessing the application. Existing operators can still sign in after an upgrade and enable 2FA in Security settings.
- Login and password, connection and project changes require a fresh authenticator code once 2FA is enabled. Critical changes require enrollment even for existing operators. Changing a password ends all sessions.
- PushDocs does not send email. Administrators share invitation links through a messenger. Each link is bound to one email address, can be accepted once and expires within 24 hours.
- A GitLab connection can store an encrypted inline OpenVPN profile when VPN support is enabled for the installation. Provider requests and Git HTTPS traffic then pass through an isolated VPN gateway. The installation supports four active VPN profiles.
- One installation can import and manage several projects. Each project has its own members and roles.
- The worker imports the default branch and discovers every remote branch. A user can load another branch without replacing the active branch context. The Documents header offers **Обновить из Git** to refresh the selected branch, including the default branch. Editors can use **Влить <default branch>…** on an unprotected task branch before or after creating a PR or MR. This fetches both branches, merges and pushes with an exact branch lease, then reloads the imported documents. Drafts remain in PushDocs. Conflicting Git branches are left unchanged and must be resolved in Git before retrying.
- Editors can create and edit Markdown or MDX documents. Drafts use revision checks and autosave to prevent one browser tab from silently overwriting another.
- Editors can upload images, MP4, PDF, ZIP, CSV and TXT files. PushDocs includes documents and attachments in one commit.
- Readers can comment on documents. Comment and status updates reach open pages through server-sent events.
- Editors can send a change set to GitHub or GitLab and create a pull request or merge request. Native Git uses an exact branch lease during the push, and a persistent prepared-commit journal makes interrupted submissions retryable without duplicate commits.
- If the remote branch changes in the same files, PushDocs records a three-way conflict and provides a text conflict editor.
- The review screen displays open pull requests or merge requests and their current checks.
- A project can register custom MDX components. The editor inserts their configured source snippets and shows safe placeholders in preview.
- The document workbench has a file tree, persisted and closeable tabs, content search, language/version/status filters, highlighted MDX source with line numbers, scalar metadata forms, quick Markdown preview, and side-by-side comparison. It preserves untouched MDX bytes and line endings when editing.
- Administrators can create and edit `.pushdocs/config.json` in the workbench. It defines document roots, editable technical files, document templates and media paths. Media components are enabled explicitly in `media.components`, with their JSX names, storage and optional `srcBase`. The configuration reference includes a DocMedia/Video example. Every field is described in the [configuration reference](docs/configuration.md).
- The media library lists existing Git files and uploads, supports drag and drop, progress, cancellation, retry, deletion and link insertion. Uploads require explicit replacement of existing files. Limits are 64 MiB per file, 256 MiB per submission and four active uploads per project.
- After changes are sent, the review screen links to the documentation preview built by the repository's existing CI pipeline.

The web application and worker do not execute repository JavaScript. Quick preview renders Markdown without executing MDX; the repository's CI pipeline renders the complete site after changes are sent.

The Documents page can also start a local Docusaurus preview for a trusted project. The runner prepares persistent Git worktrees for imported branches in the background. Branches of one project share a Git object cache. Saved drafts and attachments are copied into their branch workspace, and unchanged files are left untouched. The runner installs dependencies when installation inputs change and starts the configured development command. It retains installed dependencies when the branch commit changes. After dependencies are ready, the runner removes its Yarn download cache unless the project uses Plug’n’Play. After all site processes stop, it removes its Webpack cache. Cleanup errors are logged and do not prevent the site from stopping. The button opens the result on `http://213.148.1.118:<port>`. Leaving the Documents page starts a server-side one-hour idle lease. Returning to Documents attaches to an already requested preview and cancels the idle countdown. Each later exit starts a fresh hour. Explicit stop and deletion still act immediately. The workspace remains available for subsequent starts.

The local preview executes repository JavaScript. Enable it only for repositories whose code is trusted by the installation operator. Caddy automatically publishes and proxies the fixed HTTP range `43000` to `43019`; the preview runner itself is reachable only inside the Compose network. Preview endpoints do not use PushDocs session authentication.

## Current limits

- PushDocs displays provider checks, but merging still happens in GitHub or GitLab.
- The review screen switches to branches from the connected repository. For a PR or MR from a fork, the branch switch button is disabled. Editing a fork in PushDocs requires connecting it as a separate project. Older review data must be refreshed before its source branch can be opened.
- Comments are stored in PushDocs and are not copied to provider discussions.
- Review state is refreshed every 30 seconds. Provider webhooks are not implemented yet.
- The write path has real local Git and PostgreSQL integration tests. Live provider acceptance requires separately agreed test repositories. Tests never push to sendsay-docs.
- The updated development plan is only partially implemented. Rebase, provider discussions, structural conflicts, navigation editing and component property forms remain open. Binary conflicts currently offer the Git version or the saved upload, not a third replacement upload.
- A CI preview link becomes available only after the `preview:deploy` check succeeds for the current PR or MR commit.

## Run

Choose one mode and follow its commands below. Requires Docker with Compose v2; development also requires Node.js >=20.19.0 and Yarn 4.17.1. Start Docker and run commands from the repository root.

| Mode | Application processes | Default address |
| --- | --- | --- |
| Development | Run through Yarn with automatic reload; PostgreSQL runs in Docker | http://localhost:3000 |
| Docker | All services run in containers | http://localhost:8080 |

### First run

**Development:** create `.env` from `.env.example` if it does not exist. Set the secrets and use the same password in `DATABASE_URL` and `POSTGRES_PASSWORD`. `DATABASE_URL` must point to the local PostgreSQL port (5432 by default).

~~~sh
yarn install
docker compose up -d --wait postgres
yarn db:migrate
yarn dev:all
~~~

**Docker:**

~~~sh
./scripts/install.sh http://localhost:8080
~~~

The installer creates `.env`, builds images, applies migrations and starts services. An existing `.env` keeps its configured origin and ports.

Open the application's address and create the first operator.

### Subsequent starts

Start Docker and run the commands for the same mode.

**Development:**

~~~sh
docker compose up -d --wait postgres
yarn dev:all
~~~

Run `yarn db:migrate` against the running database when new migrations appear.

**Docker:**

~~~sh
docker compose up -d --wait
~~~

Docker applies migrations automatically

**Extra info:**

See [Installation and operations](docs/operations.md) for switching modes, public installation, VPN and other settings.

## Attachments

Uploads use `static/img` by default and remain drafts until sent to Git. See the [attachment configuration](docs/configuration.md#вложения) for storage paths, localized URLs and a sendsay-docs example.

## CI preview

If the documentation repository already deploys a preview for every PR or MR, add its URL template to `.env` and restart PushDocs:

~~~sh
PUSHDOCS_PREVIEW_URL=https://pr-{MR_NUMBER}.docs.example.com/
~~~

PushDocs accepts `{MR_NUMBER}`, `{PR_NUMBER}` and the provider-neutral `{REVIEW_NUMBER}` placeholder. The review page enables **Открыть предпросмотр** after `preview:deploy` succeeds for the current commit. Until then it shows that the preview is updating. The exact site preview therefore uses the same CI deployment that reviewers already use; before sending changes, the editor continues to provide its safe Markdown preview.

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

Architecture decisions are listed in [the ADR index](docs/adr/index.md), starting with [the application architecture](docs/adr/0001-pushdocs-architecture.md). Compatibility notes for sendsay-docs are in [the import report](docs/compatibility/sendsay-docs.md).

The [development plan](docs/development-plan.md) separates delivered capabilities from remaining work. The [verification report](docs/verification-2026-09-08.md) records automated checks, browser scenarios and limits of the compatibility claims.

## MCP

Remote access for Codex and Claude Code is documented in [MCP setup](docs/mcp.md).
See the [implementation plan](docs/mcp-plan.md) and [MCP ADR](docs/adr/0004-mcp-access.md).
