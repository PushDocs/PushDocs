# Draft preview setup

The runner is an optional experimental service. It builds a frozen Git revision with the branch's saved drafts and attachments, without pushing to Git. Repository code runs only in a short-lived container. The trusted runner, not that container, has database access, provider credentials and Docker access.

## Operator requirements

- Use a dedicated Docker host for the runner when repositories are not fully trusted. Docker socket access gives the trusted runner control of that daemon.
- Prepare a Node image matching the project's runtime and package manager. Its dependency cache must satisfy the project's lockfile without network access. Private registry credentials belong in a separate trusted preparation process and must not remain in the runtime image.
- Set `PUSHDOCS_PREVIEW_IMAGE` for a shared default image, or configure project-specific images in `PUSHDOCS_PREVIEW_RUNTIMES` as described below.
- Choose a wildcard preview domain on a different registrable domain from the CMS. Terminate HTTPS and proxy that domain to the runner on port 4200, preserving the original Host. Do not forward CMS cookies to preview. Do not expose port 4200 without the intended proxy policy.
- Generate a random `PUSHDOCS_PREVIEW_KEY` of at least 32 characters. Configure the same key and domain on web and runner. The domain value has no scheme, for example `preview.example.net`.

After setting the normal application secrets and these preview values:

```sh
docker compose -f compose.yml -f compose.preview.yml up --build
```

The overlay requires a Docker version supporting volume subpaths. The tested daemon is Docker 28. Web and worker do not receive the Docker socket. A build mounts only its own input, control and output directories.

Build containers have no network, run as UID 1000 with a read-only root filesystem, drop capabilities and cannot gain privileges. Default limits are 4 GiB memory, 2 CPUs, 256 processes, 2 GiB temporary filesystem and 15 minutes per build. The snapshot and output limits are each 256 MiB; a snapshot may contain at most 20,000 files. One runner executes one build at a time. The API permits one active build per branch and at most two per project.

The runner removes completed build records and files after seven days. Within that period it keeps at most three successful builds and ten failed builds per project branch. Cleanup runs between builds, at most once a minute, and never removes queued or running builds. Preview links to removed builds stop working. These generated outputs are not backups of drafts or attachments. Operators must still monitor total disk use across projects and branches.

## Project runtimes and private dependencies

The operator can set `PUSHDOCS_PREVIEW_RUNTIMES` to a JSON object in the runner environment:

```json
{
  "docs-node20": {
    "image": "registry.example.test/docs-runtime:reviewed-lockfile",
    "projects": ["00000000-0000-4000-8000-000000000001"],
    "memoryMiB": 4096,
    "cpus": 2,
    "timeoutSeconds": 900
  }
}
```

Replace the example project ID with its PushDocs ID. Set `preview.runtime` in that project's `.pushdocs/config.json` to `docs-node20`. A repository can select a profile, but it cannot change the image, resource limits or project grants. An unavailable profile fails the build before loading its dependency cache. `projects: ["*"]` explicitly shares a cache with every project and must only be used for public dependencies. The fallback `PUSHDOCS_PREVIEW_IMAGE` is also shared with every project.

Prepare private dependencies in an operator-controlled process. Do not run an imported repository's install scripts, package manager plugins or build commands while registry credentials are present. Review the lockfile and package-manager configuration first. Download dependencies with scripts disabled using a trusted registry client, then copy only the offline cache into a clean runtime image. Registry configuration, tokens and private CA credentials must not remain in image layers or build logs. The runtime receives neither registry credentials nor network access. Changes to the lockfile require a new cache image; a missing dependency produces a visible offline install error.

The named profile may set memory from 512 to 16384 MiB, CPU from 0.5 to 8 and the container deadline from 30 to 1800 seconds. Install and build commands also have individual ten-minute deadlines. These settings do not enable network access or privileged containers. The private-dependency preparation process still requires a project-specific operator check before production use.

## Project configuration

An administrator opens **Документы → Конфигурация проекта**. The file is `.pushdocs/config.json` relative to the configured project root. A minimal example:

```json
{
  "version": 1,
  "defaultLocale": "ru",
  "documentRoots": ["docs", "versioned_docs", "i18n"],
  "editableFiles": ["sidebars.js", "sidebars.ts", ".pushdocs/config.json"],
  "media": { "directory": "static/img", "publicUrl": "/img" },
  "templates": [
    {
      "id": "article",
      "label": "Article with translation",
      "path": "docs/{slug}.md",
      "content": "# {title}\n",
      "companions": [
        {
          "path": "i18n/{locale}/docusaurus-plugin-content-docs/current/{slug}.md",
          "content": "# {title}\n"
        }
      ]
    }
  ],
  "preview": {
    "runtime": "default",
    "install": ["yarn", "install", "--offline", "--frozen-lockfile"],
    "build": ["yarn", "build"],
    "output": "build"
  }
}
```

This example uses Yarn Classic for the imported site. PushDocs itself uses Yarn 4. Use commands and an image matching the imported project's own package manager and lockfile. Changing commands in the repository does not enable network access or add secrets.

Template placeholders are `title`, `slug` and `locale` in the current UI. Companion files are created together with the article and fail as one operation on a collision. A template can also declare `updates`, each with `path`, `find` and `replace`. A rule replaces exactly one matching source fragment in an existing file. Missing or repeated fragments stop the entire operation, leaving the source editor available. The editor displays all planned files before applying them, and the server rejects a plan that changed after this preview. Rules do not execute JavaScript or infer dynamic navigation.

The `metadata` array configures front matter fields with `name`, `label` and `type` (`string`, `number` or `boolean`). The form patches individual scalar ranges and preserves other fields, comments and document bytes. Complex YAML values remain read-only in the form and can be edited in the source view. Executable front matter formats are never evaluated.

Media supports `locale`, `documentDir` and `document` placeholders. Paths and public URLs are separate: a directory such as `staticLocalized/{locale}/img` may use `pathname:///img` as its URL. Configure this to match how the site's own build serves assets. PushDocs does not infer custom localization plugins.

## Reproduce the synthetic Docusaurus check

The public fixture has Russian and English locales and a custom `Callout` component. It contains no sendsay-docs content or credentials.

```sh
npx --yes yarn@1.22.22 --cwd tests/fixtures/docusaurus install --ignore-scripts --cache-folder ../../../output/playwright/yarn-cache --registry https://registry.npmjs.org
node tests/fixtures/docusaurus/check-bundler.cjs
docker build -f deploy/preview-smoke.Dockerfile -t pushdocs-preview-smoke:local .
```

`scripts/mock-gitlab.mjs`, `scripts/seed-ui.ts` and `scripts/seed-preview.ts` provide the local UI fixtures. Seed scripts refuse any database except the dedicated local test database at port 55432. They create a synthetic local session, not production authentication. Review their guards and required environment before running them.

For local preview only, use `PUSHDOCS_PREVIEW_DOMAIN=localhost:4200` and `PUSHDOCS_PREVIEW_SCHEME=http` in both web and runner. When running the runner outside Docker, set `PUSHDOCS_PREVIEW_DIR` and `PUSHDOCS_PREVIEW_HOST_DIR` to the same dedicated absolute output directory. The Docker daemon must be able to access it. Share the attachments directory with web using `PUSHDOCS_ATTACHMENTS_DIR`.

Open **Открыть сайт**, request a build and wait for **Готово**. The signed link lasts 15 minutes and is exchanged for an HttpOnly preview cookie. It grants access to that build, so do not share it with unauthorized readers. A newer draft marks the old preview as stale but does not change its contents.

The optional `Обновлять после сохранения` checkbox watches saved revisions while the preview page is open. It coalesces changes for eight seconds after the next status refresh and waits for any active build to finish. It does not retry failed builds indefinitely. Use the build button to retry an error.
