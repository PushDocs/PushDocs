# Installation and operations

For first setup and subsequent starts, see [Run](../README.md#run).

## Public installation and VPN

For a public installation, run the installer with the public origin of the CMS:

~~~sh
./scripts/install.sh https://docs.example.com
~~~

The installer creates `.env` with a PostgreSQL password, session pepper and encryption key. It sets permission mode 600 and does not replace the file on later runs. Back up `.env` separately from the database and attachments because the encryption key is required to read saved Git credentials. VPN support is disabled by default.

Enable VPN support only when a GitLab connection needs an OpenVPN profile:

~~~sh
./scripts/install.sh https://docs.example.com --enable-vpn
~~~

`PUSHDOCS_PUBLIC_ORIGIN` is the only value the installer cannot generate. It must match the DNS name and TLS address used by browsers. Production installations require an HTTPS origin. Plain HTTP is accepted only for localhost.

Open the configured origin and create the first operator. Add a Git connection, then connect a Docusaurus project. You can paste a repository URL, a GitLab numeric project ID, a GitLab namespace and path, or a GitHub owner and repository name. The worker imports the default branch in the background.

An operator can attach an optional `.ovpn` file to a GitLab HTTPS connection after VPN support is enabled. The profile must use a TUN device and contain its CA, client certificate, and unencrypted private key in inline blocks. PushDocs rejects profiles that run scripts, load plugins, refer to external credential files, or omit server certificate verification. If the VPN is unavailable, PushDocs does not try the provider without the VPN.

VPN profiles use four gateway containers named `vpn-gateway-1` through `vpn-gateway-4`. Docker Compose starts them only through the `vpn` profile. Each container has its own network routes and receives `NET_ADMIN` and `/dev/net/tun`. The web and worker containers do not receive these permissions. The host must provide `/dev/net/tun` to Docker only when VPN support is enabled.

For subsequent starts with VPN enabled, run `docker compose --profile vpn up -d --wait`.

Every successful production deployment updates the environment file when a release introduces a new generated secret, runs database migrations, and starts the enabled services before the application. Existing secrets remain unchanged. Set the `PUSHDOCS_VPN_ENABLED` deployment variable to `1` before adding a VPN profile. For a manual self-hosted update, run the installer with `--enable-vpn`, or use `--disable-vpn` to stop the gateway containers. Use `--prepare-only` to update `.env` without starting containers.

## Switching between startup modes

Use one application mode at a time. Before switching from development to Docker, stop the Yarn processes with Ctrl+C.

Before switching from Docker to development, stop the application containers while keeping PostgreSQL:

~~~sh
docker compose stop caddy web worker realtime preview
~~~

If `.env` was created by the installer, add the local settings from `.env.example`, including `DATABASE_URL` pointing to PostgreSQL on localhost. Keep the existing secrets and use the existing `POSTGRES_PASSWORD` in that URL. Set `PUSHDOCS_PUBLIC_ORIGIN=http://localhost:3000` and `PUSHDOCS_REALTIME_ORIGIN=http://127.0.0.1:4100` for development.

Then follow the commands for the selected mode in [Run](../README.md#run). When switching back to Docker, use the origin and published port configured in `.env`.

## Authentication and recovery

During 2FA setup, scan the QR code with Google Authenticator or a compatible app. Store the manual setup key in a password manager so you can restore the authenticator if the phone is lost. PushDocs has no email recovery flow. Codes expire every 30 seconds and cannot be reused, including between login and a critical action. After ten authentication attempts in a 15-minute window, wait for the window to expire. Successful TOTP verification resets the attempt count.

TOTP secrets use the existing installation encryption key and are bound to the user and setup stage. Back up that key with the database. The upgrade preserves password-only login only for operators that already existed when migration 011 ran. Other accounts must enroll. Existing invitations are also capped at 24 hours from creation.

`yarn test:security` uses `PUSHDOCS_TEST_DATABASE_URL` to test upgrade compatibility, concurrent invitation acceptance, TOTP replay protection and session revocation. It creates and removes a separate random database and accepts only a local PostgreSQL server.

## Service status and shutdown

~~~sh
docker compose ps           # Show service status
docker compose logs -f web  # Follow web application logs
docker compose down        # Stop containers; keep data volumes
~~~

## Development and preview settings

The web application listens on port 3000, and the realtime process listens on port 4100.
Set `PUSHDOCS_REALTIME_ORIGIN=http://127.0.0.1:4100` for direct local development. Compose routes `/events` through Caddy. Set `PUSHDOCS_PUBLIC_ORIGIN` to the exact public CMS origin when using a reverse proxy.

Caddy publishes ports `43000` to `43019` and proxies each port to the preview runner over the Compose network. Set `PUSHDOCS_PREVIEW_PUBLIC_HOST` to the IP address that browsers use to reach the installation. A project can set `preview.install` and `preview.start` in `.pushdocs/config.json`. The default start command is `yarn start --host 0.0.0.0 --port {port} --no-open`; it uses native filesystem watching.

By default, one site can run at a time (`PUSHDOCS_PREVIEW_MAX_ACTIVE=1`). Additional sites wait in a visible queue. The preview container has a hard limit of 5 GiB of memory, no additional swap, 2 CPU cores and 512 processes. Set `PUSHDOCS_PREVIEW_CONTAINER_MEMORY` and `PUSHDOCS_PREVIEW_CPUS` to adjust the container limits. Each runtime user is monitored against `PUSHDOCS_PREVIEW_MEMORY_MB=4096` MiB, including installation processes and descendants. Node's heap defaults to 1536 MiB (`PUSHDOCS_PREVIEW_NODE_HEAP_MB`) and is capped to leave at least 1024 MiB for other allocations. Increasing the site RSS budget does not automatically increase V8's heap budget. Exceeding the runtime budget stops all processes of that site's isolated user, including detached descendants, and produces a notification. The runner also clears orphaned processes before restarting that runtime user. Keep the combined runtime budgets below the container limit with room for the controller and Git preparation; increasing concurrency requires adjusting the container budget as well. PostgreSQL remains the durable source of drafts, and the workspace can be reconstructed from it and Git. Users start previews explicitly from Documents or open them from the Preview section. Visiting a branch does not start its site. The default branch workspace stays deployed and is protected from deletion and cache eviction. Stopping a site keeps its workspace. Other inactive preview workspaces are retained for one day. Every five minutes, the runner also checks the entire preview directory against `PUSHDOCS_PREVIEW_CACHE_MAX_MB=8192` MiB and removes the least recently used inactive workspaces when it exceeds that budget. Shared Git objects and legacy or interrupted checkouts count towards the budget. Active sites and workspaces being prepared are protected; if they alone exceed the budget, the runner reports it in its logs. Evicted branches are prepared again on demand rather than immediately rebuilt in the background.

For a standard Docusaurus start command, the runner generates a separate preview configuration beside the source configuration. Docusaurus resolves relative plugin paths from that directory. The generated file keeps the original site configuration and plugins, but uses a memory cache with one generation and disables source maps. Large imported GIFs otherwise produce large filesystem cache packs and additional buffers on recompilation. The source configuration and installed dependencies are not modified, and the generated file is removed on shutdown. Commands with an explicit `--config` or `-c` keep their own settings. Other frameworks are unchanged. Media buffers still count toward the site's RSS budget, so sites with large imported assets may need a higher RSS budget even when their JavaScript heap is small.
