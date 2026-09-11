#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Never use compose.override.yml, .env, or the running developer installation.
project="pushdocs-ci-$(date +%s)-$$"
backup=$(mktemp -d)
export PUSHDOCS_IMAGE=${PUSHDOCS_IMAGE:-pushdocs:ci}
port=${PUSHDOCS_CI_PORT:-18080}
export PUSHDOCS_HTTP_PORT="127.0.0.1:$port"
export PUSHDOCS_HTTPS_PORT="127.0.0.1:0"
export PUSHDOCS_ADDRESS=:80
export PUSHDOCS_PUBLIC_ORIGIN="http://localhost:$port"
export PUSHDOCS_E2E_BASE_URL="$PUSHDOCS_PUBLIC_ORIGIN"
export POSTGRES_PASSWORD
POSTGRES_PASSWORD=$(openssl rand -hex 32)
export PUSHDOCS_ENCRYPTION_KEY
PUSHDOCS_ENCRYPTION_KEY=$(openssl rand -base64 32)
export PUSHDOCS_SESSION_PEPPER
PUSHDOCS_SESSION_PEPPER=$(openssl rand -hex 32)
export PUSHDOCS_VPN_GATEWAY_TOKEN
PUSHDOCS_VPN_GATEWAY_TOKEN=$(openssl rand -hex 32)
unset PUSHDOCS_E2E_RESTORED

compose() { docker compose --env-file /dev/null -p "$project" -f compose.yml "$@"; }
fixture() {
  compose run --rm --no-deps -T -e PUSHDOCS_CI_FIXTURE=1 worker \
    yarn workspace @pushdocs/worker exec tsx /app/scripts/ci/restore-fixture.ts "$1"
}
cleanup() {
  result=$?
  trap - EXIT
  compose logs --no-color > output/ci/compose.log 2>&1 || true
  compose down --volumes --remove-orphans || result=1
  rm -rf "$backup"
  exit "$result"
}
mkdir -p output/ci
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose config --quiet
compose up --no-build --wait --wait-timeout 180
health_response=""
for _ in {1..30}; do
  if health_response=$(curl --fail --silent "$PUSHDOCS_E2E_BASE_URL/api/health" 2>/dev/null); then
    break
  fi
  sleep 1
done
if [[ -z "$health_response" ]]; then
  echo "The application did not become reachable through Caddy" >&2
  exit 1
fi
echo "$health_response"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$PUSHDOCS_E2E_BASE_URL/events")" = 401
test "$(compose exec -T worker id -u)" = 1001
compose exec -T worker git --version
compose exec -T worker sh -c 'test -w /app/apps/worker/data/git && test -w /data/attachments'
yarn e2e

# Stop writers before backing up PostgreSQL and attachments; keep the key separately.
compose stop caddy web worker realtime
fixture seed
compose exec -T postgres pg_dump -U pushdocs -d pushdocs -Fc > "$backup/database.dump"
compose run --rm --no-deps -T worker tar -C /data/attachments -cf - . > "$backup/attachments.tar"
printf '%s' "$PUSHDOCS_ENCRYPTION_KEY" > "$backup/encryption-key"

# Destroy only this run's disposable data, then restore into an empty database.
compose exec -T postgres dropdb -U pushdocs pushdocs
compose exec -T postgres createdb -U pushdocs pushdocs
compose run --rm --no-deps -T worker rm /data/attachments/ci-restore.bin
compose exec -T postgres pg_restore -U pushdocs -d pushdocs --exit-on-error < "$backup/database.dump"
compose run --rm --no-deps -T worker tar -C /data/attachments -xf - < "$backup/attachments.tar"
PUSHDOCS_ENCRYPTION_KEY=$(cat "$backup/encryption-key")
fixture verify
compose run --rm --no-deps -T migrate
compose up --no-build --wait --wait-timeout 180
PUSHDOCS_E2E_RESTORED=1 yarn e2e
echo 'PASS: Compose installation, browser sessions, backup and restore'
