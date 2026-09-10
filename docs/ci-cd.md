# CI and container delivery

The [GitHub Actions workflow](../.github/workflows/ci.yml) runs on pull requests, pushes to `stable`, version tags beginning with `v`, merge queues and manual dispatch. It implements the automated checks listed in [ADR-0001](adr/0001-pushdocs-architecture.md). Actions are pinned to commit SHAs, and Dependabot proposes weekly updates.

## Required checks

The `CI` job succeeds only when all three jobs succeed:

| Job | Checks |
| --- | --- |
| Quality checks | Immutable Yarn install, lint, format, package boundaries, TypeScript, unit tests and production build |
| PostgreSQL and Git recovery | Real PostgreSQL 17 and temporary local Git repositories, including retry after an accepted push and concurrent writes |
| Compose, browser and restore | Generated installation secrets, both Docker images, Compose configuration, migrations, service health, Chromium sessions, backup and restore |

The installation job uses a unique Compose project and fresh volumes. It checks the application through Caddy, including the unauthenticated SSE response. Chromium creates the first operator, checks incorrect credentials, logs in and verifies that a second browser context remains anonymous.

The restore check stops application writers and creates a synthetic uncommitted draft, encrypted provider connection and binary attachment. It saves PostgreSQL and the attachment volume, with the encryption key in a separate temporary file. It then removes the fixture database and attachment, restores them and verifies their contents. Chromium logs in again after restoration. Cleanup removes only the temporary Compose project and its volumes.

Logs, screenshots and Playwright traces are retained for seven days. Database dumps and encryption keys are deleted locally and are not uploaded as artifacts.

`yarn test:coverage` retains the existing thresholds. On 9 September 2026, all 644 unit tests passed, but coverage was below those thresholds: lines 95.2%, statements 93.66%, functions 93.01% and branches 88.77%. Coverage enforcement is available through the `coverage` option on a manual workflow run. The default CI uses `yarn test`, as required by the ADR.

The browser suite currently covers installation and sessions. Live GitHub/GitLab acceptance, complete document editing scenarios and load tests remain outside this workflow. The preview service image is built and its Docker CLI is checked; Compose configuration and unit tests cover runner policy. CI does not claim to validate a production preview host or build private documentation.

## Published images

After `CI` succeeds on a push, a separate job publishes the saved images from the installation job. It does not rebuild them. Only the publication job receives `packages: write`; pull requests do not receive registry credentials.

| Source | Application image | Preview service image |
| --- | --- | --- |
| `stable` | `ghcr.io/pushdocs/pushdocs:stable` | `ghcr.io/pushdocs/pushdocs-preview:stable` |
| `v0.1.0` | `ghcr.io/pushdocs/pushdocs:0.1.0` | `ghcr.io/pushdocs/pushdocs-preview:0.1.0` |
| Any published commit | `ghcr.io/pushdocs/pushdocs:sha-<full SHA>` | `ghcr.io/pushdocs/pushdocs-preview:sha-<full SHA>` |

Version tags must have the form `vMAJOR.MINOR.PATCH`, optionally followed by a prerelease suffix such as `-rc.1`. Images target Linux AMD64. The job summary and the `image-digests` artifact record the exact published references. Use an `image@sha256:...` reference for installation and updates, since tags can be moved.

Set `PUSHDOCS_IMAGE` to the application reference. The optional preview overlay accepts `PUSHDOCS_PREVIEW_SERVICE_IMAGE` for the runner service. `PUSHDOCS_PREVIEW_IMAGE` still identifies the separate runtime that builds a documentation project.

Delivery ends at GHCR. Operators update their own servers using the published digests and their production configuration. Before migrations, stop writers and take a consistent backup of the database and attachments, with the encryption key stored separately. Pull the images, run the one-shot `migrate` service and start the application only after migration succeeds. The smoke test validates restoration of the current schema; it does not prove compatibility with every previous release or allow rollback after an incompatible migration.

The first installation runs `./scripts/install.sh https://docs.example.com`. The installer generates the PostgreSQL password, session pepper and encryption key in a mode 600 `.env` file. It never rotates existing secrets. The public origin remains an explicit input because it depends on the operator's DNS and TLS setup.

## GitHub setup

GitHub Actions is enabled for the repository. Once the workflow has run, select `CI` as a required status check in **Settings → Rules → Rulesets** for `stable`. The workflow reports results but does not change branch rules.

GHCR publication uses the workflow's `GITHUB_TOKEN`, so no personal token secret is needed. Organization policy must allow package creation. If an existing package is used, give this repository write access in the package's **Settings → Manage Actions access**. For anonymous image pulls, set package visibility to public after the first publication.

Create a version tag on a reviewed commit to request a release. Manual workflow dispatch checks the selected ref without publishing images.

## Run locally

Use the Node version from the Dockerfile and Yarn from `packageManager`:

```sh
corepack enable
yarn install --immutable
yarn check
```

Run the installation check against newly built images:

```sh
docker build -t pushdocs:ci .
docker build -f deploy/preview.Dockerfile -t pushdocs-preview:ci .
yarn playwright install chromium
yarn smoke:install
```

The smoke script uses port 18080 by default; set `PUSHDOCS_CI_PORT` if it is occupied. It explicitly ignores `.env` and `compose.override.yml`. `yarn e2e` requires `PUSHDOCS_E2E_BASE_URL` pointing to a disposable local installation and is normally called by the smoke script.

## Initial verification

On 9 September 2026, lint, formatting, architecture checks, TypeScript, all 644 unit tests, the production build and PostgreSQL/Git integration passed locally. Actionlint and ShellCheck passed. The Compose smoke test passed both browser phases and verified restored draft bytes, the encrypted connection and attachment bytes. Its temporary containers and volumes were removed.

Local BuildKit timed out and Docker Hub returned `EOF`, so a clean Docker build could not be completed on this host. For the smoke run, the current application source was rebuilt with cached dependencies from the existing local image, including the new writable attachment directory. The preview CLI check used the existing local runner image. A first hosted workflow run must still verify clean Linux AMD64 image builds and GHCR publication. No images were published during local verification.
