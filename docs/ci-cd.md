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

Every push to `stable` runs its own complete check set. After successful publication, it is deployed to production. The deployment uses the tested application digest, transfers only the Compose and deployment files over SSH, and pulls the public image without registry credentials. A server lock serializes concurrent deployments, and the run number prevents an older, slower workflow from replacing a newer release. Before migrations, the script stops writers and saves PostgreSQL and attachments under `~/pushdocs-backups`. It stores a mode 600 copy of `.env` separately under `~/pushdocs-secret-backups`. The latest ten deployment backups are retained. The new services start only after the one-shot migration succeeds. The smoke test validates restoration of the current schema; it does not prove compatibility with every previous release or allow rollback after an incompatible migration.

The first installation runs `./scripts/install.sh https://docs.example.com`. The installer generates the PostgreSQL password, session pepper and encryption key in a mode 600 `.env` file. It never rotates existing secrets. The public origin remains an explicit input because it depends on the operator's DNS and TLS setup.

## GitHub setup

GitHub Actions is enabled for the repository. Once the workflow has run, select `CI` as a required status check in **Settings → Rules → Rulesets** for `stable`. The workflow reports results but does not change branch rules.

GHCR publication uses the workflow's `GITHUB_TOKEN`, so no personal token secret is needed. Organization policy must allow package creation. If an existing package is used, give this repository write access in the package's **Settings → Manage Actions access**. For anonymous image pulls, set package visibility to public after the first publication.

Production deployment reads these repository settings:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `SSH_HOST` | Production server host or IP address |
| Variable | `SSH_USER` | SSH account with Docker access |
| Secret | `SSH_KEY` | Private key accepted by that account |
| Optional variable | `PUSHDOCS_PUBLIC_ORIGIN` | Exact HTTPS origin for a custom DNS name |
| Optional variable | `PUSHDOCS_PREVIEW_URL` | HTTPS preview URL template with a supported review number placeholder |

When `PUSHDOCS_PUBLIC_ORIGIN` is absent and `SSH_HOST` is an IPv4 address, the first deployment uses `https://pushdocs.<dashed-ip>.sslip.io`. This gives the clean installation a DNS name for automatic TLS without another required setting. Add your own DNS record and set the optional variable when a permanent domain is ready.

Both application variables are copied to the server `.env` on every successful deployment. `PUSHDOCS_PREVIEW_URL` accepts `{MR_NUMBER}`, `{PR_NUMBER}` or `{REVIEW_NUMBER}`. Set it to an empty repository variable to disable the external preview link.

The server's public Ed25519 host key is pinned in `.github/ssh_known_hosts`. A secret is unnecessary because host keys are public. Pinning still matters: SSH must reject a different server instead of sending deployment commands through an unverified connection. Update the checked-in key through an already trusted connection after an intentional SSH host-key rotation.

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
