#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

image=${1:-}
public_origin=${2:-}
preview_url=${3:-}
run_number=${4:-}
revision=${5:-}
backup_root=${PUSHDOCS_BACKUP_DIR:-$HOME/pushdocs-backups}
secret_backup_root=${PUSHDOCS_SECRET_BACKUP_DIR:-$HOME/pushdocs-secret-backups}

if [[ ! "$image" =~ ^ghcr\.io/pushdocs/pushdocs@sha256:[0-9a-f]{64}$ ]]; then
  echo "Expected an immutable ghcr.io/pushdocs/pushdocs image digest." >&2
  exit 2
fi

if [[ ! "$public_origin" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
  echo "The production public origin must be an HTTPS host without a path or port." >&2
  exit 2
fi

if [[ -n "$preview_url" ]]; then
  if [[ "$preview_url" != https://* || "$preview_url" == *"'"* || "$preview_url" == *$'\n'* || "$preview_url" == *$'\r'* ]]; then
    echo "The preview URL must be a safe HTTPS URL template." >&2
    exit 2
  fi
  if [[ "$preview_url" != *'{MR_NUMBER}'* && "$preview_url" != *'{PR_NUMBER}'* && "$preview_url" != *'{REVIEW_NUMBER}'* ]]; then
    echo "The preview URL must contain a supported review number placeholder." >&2
    exit 2
  fi
fi

if [[ ! "$run_number" =~ ^[0-9]+$ || ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected a GitHub Actions run number and full commit SHA." >&2
  exit 2
fi

for command in docker flock openssl curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

exec 9>.deploy.lock
flock 9

if [[ -f .deployed-run-number ]]; then
  deployed_run_number=$(cat .deployed-run-number)
  if [[ ! "$deployed_run_number" =~ ^[0-9]+$ ]]; then
    echo ".deployed-run-number is invalid." >&2
    exit 1
  fi
  if (( run_number < deployed_run_number )); then
    echo "Skipping stale run $run_number; run $deployed_run_number is already deployed."
    exit 0
  fi
fi

if [[ ! -f .env ]]; then
  ./scripts/install.sh "$public_origin" --prepare-only
fi
chmod 600 .env

set_setting() {
  local key=$1
  local value=$2
  local temporary
  temporary=$(mktemp .env.tmp.XXXXXX)
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" .env
}

compose=(docker compose --env-file .env -f compose.yml)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_id="$timestamp-run-$run_number"
secret_backup="$secret_backup_root/$backup_id.env"
install -d -m 700 "$backup_root" "$secret_backup_root"
install -m 600 .env "$secret_backup"
printf 'Saved the separate environment backup as %s\n' "$secret_backup"

if [[ -n "$("${compose[@]}" ps --status running -q postgres 2>/dev/null)" ]]; then
  backup="$backup_root/$backup_id"
  install -d -m 700 "$backup"

  echo "Stopping application writers before backup."
  "${compose[@]}" stop caddy web worker realtime
  "${compose[@]}" exec -T postgres pg_isready -U pushdocs -d pushdocs

  database_tmp="$backup/database.dump.tmp"
  attachments_tmp="$backup/attachments.tar.tmp"
  trap 'rm -f "$database_tmp" "$attachments_tmp"' EXIT
  "${compose[@]}" exec -T postgres pg_dump -U pushdocs -d pushdocs -Fc > "$database_tmp"
  "${compose[@]}" run --rm --no-deps -T worker tar -C /data/attachments -cf - . > "$attachments_tmp"
  mv "$database_tmp" "$backup/database.dump"
  mv "$attachments_tmp" "$backup/attachments.tar"
  chmod 600 "$backup/database.dump" "$backup/attachments.tar"
  trap - EXIT
  printf 'Created %s\n' "$backup"
fi

authority=${public_origin#https://}
set_setting PUSHDOCS_PUBLIC_ORIGIN "$public_origin"
set_setting PUSHDOCS_ADDRESS "$authority"
set_setting PUSHDOCS_HTTP_PORT 80
set_setting PUSHDOCS_HTTPS_PORT 443
set_setting PUSHDOCS_IMAGE "$image"
set_setting PUSHDOCS_PREVIEW_URL "$preview_url"

"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up --detach --no-build --wait --wait-timeout 180 postgres
"${compose[@]}" up --no-build --no-deps migrate
"${compose[@]}" up --detach --no-build --no-deps --wait --wait-timeout 180 web worker realtime
"${compose[@]}" up --detach --no-build --no-deps --wait --wait-timeout 180 caddy

health_url="$public_origin/api/health"
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 10 "$health_url" >/dev/null; then
    printf '%s\n' "$run_number" > .deployed-run-number.tmp
    mv .deployed-run-number.tmp .deployed-run-number
    printf '%s\n' "$revision" > .deployed-revision.tmp
    mv .deployed-revision.tmp .deployed-revision

    mapfile -t old_backups < <(
      find "$secret_backup_root" -maxdepth 1 -type f -name '*.env' -printf '%f\n' |
        LC_ALL=C sort --reverse |
        tail -n +11
    )
    for old_backup in "${old_backups[@]}"; do
      old_backup_id=${old_backup%.env}
      if [[ "$old_backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-run-[0-9]+$ ]]; then
        rm -f -- "$secret_backup_root/$old_backup"
        rm -rf -- "${backup_root:?}/$old_backup_id"
      fi
    done

    echo "Deployed $image to $public_origin"
    exit 0
  fi
  sleep 2
done

"${compose[@]}" ps >&2
"${compose[@]}" logs --no-color --tail 100 caddy web realtime >&2
echo "The containers started, but the public health endpoint is unavailable: $health_url" >&2
exit 1
