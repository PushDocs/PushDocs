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
- Editors can send a change set to GitHub or GitLab and create a pull request or merge request. The provider adapter checks the expected branch SHA before writing.
- If the remote branch changes in the same files, PushDocs records a three-way conflict and provides a text conflict editor.
- The review screen displays open pull requests or merge requests and their current checks.
- A project can register custom MDX components. The editor inserts their configured source snippets and shows safe placeholders in preview.

PushDocs does not execute JavaScript from imported repositories. The built-in preview renders Markdown and safe placeholders, so the Docusaurus CI preview remains the source for the exact site rendering.

## Current limits

- PushDocs displays provider checks, but merging still happens in GitHub or GitLab.
- Comments are stored in PushDocs and are not copied to provider discussions.
- Review state is refreshed every 30 seconds. Provider webhooks are not implemented yet.
- The write path has automated adapter tests, but it has not been run against the sendsay-docs repository with a live write token.

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

## Checks

~~~sh
yarn check
~~~

Architecture decisions are in [the ADR](docs/adr/0001-pushdocs-architecture.md). Compatibility notes for sendsay-docs are in [the import report](docs/compatibility/sendsay-docs.md).
