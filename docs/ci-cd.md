# CI and container delivery

The [GitHub Actions workflow](../.github/workflows/ci.yml) runs on pull requests, pushes to `stable`, version tags beginning with `v`, merge queues and manual dispatch. It implements the automated checks listed in [ADR-0001](adr/0001-pushdocs-architecture.md). Actions are pinned to commit SHAs, and Dependabot proposes weekly updates.

## Required checks

The `CI` job succeeds only when all three jobs succeed:

| Job | Checks |
| --- | --- |
| Quality checks | Immutable Yarn install, lint, format, package boundaries, TypeScript, unit tests and production build |
| PostgreSQL and Git recovery | Real PostgreSQL 17 and temporary local Git repositories, including retry after an accepted push and concurrent writes |
| Compose, browser and restore | Generated installation secrets, the Docker image, Compose configuration, migrations, service health, Chromium sessions, backup and restore |

The installation job uses a unique Compose project and fresh volumes. It checks the application through Caddy, including the unauthenticated SSE response. Chromium creates the first operator, checks incorrect credentials, logs in and verifies that a second browser context remains anonymous.

The restore check stops application writers and creates a synthetic uncommitted draft, encrypted provider connection and binary attachment. It saves PostgreSQL and the attachment volume, with the encryption key in a separate temporary file. It then removes the fixture database and attachment, restores them and verifies their contents. Chromium logs in again after restoration. Cleanup removes only the temporary Compose project and its volumes.

Logs, screenshots and Playwright traces are retained for seven days. Database dumps and encryption keys are deleted locally and are not uploaded as artifacts.

`yarn test:coverage` retains the existing thresholds. On 10 September 2026, all 613 unit tests passed, but coverage was below those thresholds: lines 94.98%, statements 93.39%, functions 92.75% and branches 88.28%. Coverage enforcement is available through the `coverage` option on a manual workflow run. The default CI uses `yarn test`, as required by the ADR.

The browser suite currently covers installation and sessions. Live GitHub/GitLab acceptance, complete document editing scenarios and load tests remain outside this workflow. CI does not claim to validate an external documentation preview deployment.

## Published images

After `CI` succeeds on a push, a separate job publishes the saved images from the installation job. It does not rebuild them. Only the publication job receives `packages: write`; pull requests do not receive registry credentials.

| Source | Application image |
| --- | --- |
| `stable` | `ghcr.io/pushdocs/pushdocs:stable` |
| `v0.1.0` | `ghcr.io/pushdocs/pushdocs:0.1.0` |
| Any published commit | `ghcr.io/pushdocs/pushdocs:sha-<full SHA>` |

Version tags must have the form `vMAJOR.MINOR.PATCH`, optionally followed by a prerelease suffix such as `-rc.1`. Images target Linux AMD64. The job summary and the `image-digests` artifact record the exact published references. Use an `image@sha256:...` reference for installation and updates, since tags can be moved.

Set `PUSHDOCS_IMAGE` to the application reference. Set `PUSHDOCS_PREVIEW_URL` to the existing CI preview URL template when the review screen should link to it.

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
yarn playwright install chromium
yarn smoke:install
```

The smoke script uses port 18080 by default; set `PUSHDOCS_CI_PORT` if it is occupied. It explicitly ignores `.env` and `compose.override.yml`. `yarn e2e` requires `PUSHDOCS_E2E_BASE_URL` pointing to a disposable local installation and is normally called by the smoke script.

## Initial verification

On 10 September 2026, lint, formatting, architecture checks, TypeScript, all 613 unit tests and the production build passed locally. The installation-secret test also passed. The PostgreSQL/Git integration and Compose browser smoke test were not repeated for this change.

Local BuildKit timed out and Docker Hub returned `EOF`, so a clean Docker build could not be completed on this host. For the smoke run, the current application source was rebuilt with cached dependencies from the existing local image, including the new writable attachment directory. A first hosted workflow run must still verify a clean Linux AMD64 image build and GHCR publication. No images were published during local verification.
