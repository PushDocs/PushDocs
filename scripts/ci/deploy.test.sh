#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
temporary_root=${TMPDIR:-/tmp}
temporary_root=${temporary_root%/}
temporary_directory=$(mktemp -d "$temporary_root/pushdocs-deploy.XXXXXX")
deployment_root="$temporary_directory/deployment"
mock_bin="$temporary_directory/bin"
docker_log="$temporary_directory/docker.log"

cleanup() {
  case "$temporary_directory" in
    "$temporary_root"/pushdocs-deploy.*)
      rm -rf -- "$temporary_directory"
      ;;
    *)
      echo "Refusing to remove unexpected test path: $temporary_directory" >&2
      exit 1
      ;;
  esac
}
trap cleanup EXIT

mkdir -p "$deployment_root/scripts" "$mock_bin"
cp scripts/deploy.sh scripts/install.sh "$deployment_root/scripts/"
chmod 700 "$deployment_root/scripts/deploy.sh" "$deployment_root/scripts/install.sh"

printf '%s\n' \
  'POSTGRES_PASSWORD=existing-postgres-password' \
  'PUSHDOCS_PUBLIC_ORIGIN=https://old.example.com' \
  'PUSHDOCS_SESSION_PEPPER=existing-session-pepper' \
  'PUSHDOCS_ENCRYPTION_KEY=existing-encryption-key' \
  'PUSHDOCS_VPN_ENABLED=0' \
  > "$deployment_root/.env"
chmod 600 "$deployment_root/.env"

cat > "$mock_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PUSHDOCS_DOCKER_LOG"
if [[ "$*" == 'image ls '* ]]; then
  for spec in '2026-09-15T13:00:00 1' '2026-09-15T13:00:00 1' '2026-09-15T12:00:00 2' '2026-09-15T11:00:00 3' '2026-09-15T10:00:00 4'; do
    read -r created id <<< "$spec"
    printf '%s\tsha256:%064d\tghcr.io/pushdocs/pushdocs\n' "$created" "$id"
  done
  printf '2026-09-15T09:00:00\tsha256:%064d\tpostgres\n' 5
fi
if [[ "$*" == "ps -aq --filter ancestor=sha256:$(printf '%064d' 4)" ]]; then
  echo 'in-use-container'
fi
if [[ "${PUSHDOCS_TEST_MIGRATION_FAIL:-0}" == 1 && "$*" == *'--exit-code-from migrate migrate'* ]]; then
  exit 1
fi
exit 0
EOF

cat > "$mock_bin/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "rand -hex 32" ]]; then
  printf '%064d\n' 0
  exit 0
fi
echo "Unexpected openssl invocation: $*" >&2
exit 1
EOF

cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$mock_bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$mock_bin/find" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$mock_bin/bash-env" <<'EOF'
if (( BASH_VERSINFO[0] < 4 )); then
  mapfile() {
    old_backups=("__none__")
    while IFS= read -r _line; do :; done
  }
fi
EOF
chmod 700 "$mock_bin/docker" "$mock_bin/openssl" "$mock_bin/curl" "$mock_bin/flock" "$mock_bin/find"

image="ghcr.io/pushdocs/pushdocs@sha256:$(printf '%064d' 1)"
revision=$(printf '%040d' 2)
export PATH="$mock_bin:$PATH"
export BASH_ENV="$mock_bin/bash-env"
export PUSHDOCS_DOCKER_LOG="$docker_log"
export PUSHDOCS_BACKUP_DIR="$temporary_directory/backups"
export PUSHDOCS_SECRET_BACKUP_DIR="$temporary_directory/secret-backups"
"$deployment_root/scripts/deploy.sh" \
  "$image" https://docs.example.com '' 42 "$revision" 0

grep -qx 'POSTGRES_PASSWORD=existing-postgres-password' "$deployment_root/.env"
grep -qx 'PUSHDOCS_SESSION_PEPPER=existing-session-pepper' "$deployment_root/.env"
grep -qx 'PUSHDOCS_ENCRYPTION_KEY=existing-encryption-key' "$deployment_root/.env"
grep -qx 'PUSHDOCS_VPN_GATEWAY_TOKEN=0000000000000000000000000000000000000000000000000000000000000000' "$deployment_root/.env"
[[ $(grep -c '^PUSHDOCS_VPN_GATEWAY_TOKEN=' "$deployment_root/.env") == 1 ]]
grep -qx 'PUSHDOCS_VPN_ENABLED=0' "$deployment_root/.env"

grep -Fq 'up --no-build --no-deps --exit-code-from migrate migrate' "$docker_log"
grep -Fq -- '--profile vpn stop vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log"
! grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log"
grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 web worker realtime' "$docker_log"

migration_line=$(grep -n -F 'up --no-build --no-deps --exit-code-from migrate migrate' "$docker_log" | cut -d: -f1)
application_line=$(grep -n -F 'web worker realtime' "$docker_log" | cut -d: -f1)
(( migration_line < application_line ))

: > "$docker_log"
"$deployment_root/scripts/deploy.sh" \
  "$image" https://docs.example.com '' 43 "$revision" 1

grep -qx 'PUSHDOCS_VPN_ENABLED=1' "$deployment_root/.env"
grep -Fq -- '--profile vpn up --detach --no-build --no-deps --wait --wait-timeout 180 vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log"
grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 web worker realtime' "$docker_log"

migration_line=$(grep -n -F 'up --no-build --no-deps --exit-code-from migrate migrate' "$docker_log" | cut -d: -f1)
gateway_line=$(grep -n -F 'vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log" | cut -d: -f1)
application_line=$(grep -n -F 'web worker realtime' "$docker_log" | cut -d: -f1)
(( migration_line < gateway_line && gateway_line < application_line ))

# Keep the latest two distinct images, containers and unrelated repositories.
grep -Fq "image rm sha256:$(printf '%064d' 3)" "$docker_log"
for preserved in 1 2 4 5; do
  ! grep -Fq "image rm sha256:$(printf '%064d' "$preserved")" "$docker_log"
done
! grep -Eq 'image (prune|rm.*(--force|-f))|volume (prune|rm)' "$docker_log"
cleanup_line=$(grep -n -m1 -F 'image rm ' "$docker_log" | cut -d: -f1)
pull_line=$(grep -n -m1 -F ' pull' "$docker_log" | cut -d: -f1)
(( cleanup_line < pull_line ))

# A failed migration must stop deployment before any application is started.
: > "$docker_log"
if PUSHDOCS_TEST_MIGRATION_FAIL=1 "$deployment_root/scripts/deploy.sh" \
  "$image" https://docs.example.com '' 44 "$revision" 0; then
  echo "Deployment continued after a failed migration" >&2
  exit 1
fi
! grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 web worker realtime' "$docker_log"
[[ $(cat "$deployment_root/.deployed-run-number") == 43 ]]

echo 'PASS: deploy retains current images and data, removes old images before pull, stops on migration failure and gates VPN gateways'
