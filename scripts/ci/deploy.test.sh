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
  > "$deployment_root/.env"
chmod 600 "$deployment_root/.env"

cat > "$mock_bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PUSHDOCS_DOCKER_LOG"
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
PATH="$mock_bin:$PATH" \
  BASH_ENV="$mock_bin/bash-env" \
  PUSHDOCS_DOCKER_LOG="$docker_log" \
  PUSHDOCS_BACKUP_DIR="$temporary_directory/backups" \
  PUSHDOCS_SECRET_BACKUP_DIR="$temporary_directory/secret-backups" \
  "$deployment_root/scripts/deploy.sh" \
    "$image" https://docs.example.com '' 42 "$revision"

grep -qx 'POSTGRES_PASSWORD=existing-postgres-password' "$deployment_root/.env"
grep -qx 'PUSHDOCS_SESSION_PEPPER=existing-session-pepper' "$deployment_root/.env"
grep -qx 'PUSHDOCS_ENCRYPTION_KEY=existing-encryption-key' "$deployment_root/.env"
grep -qx 'PUSHDOCS_VPN_GATEWAY_TOKEN=0000000000000000000000000000000000000000000000000000000000000000' "$deployment_root/.env"
[[ $(grep -c '^PUSHDOCS_VPN_GATEWAY_TOKEN=' "$deployment_root/.env") == 1 ]]

grep -Fq 'up --no-build --no-deps migrate' "$docker_log"
grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log"
grep -Fq 'up --detach --no-build --no-deps --wait --wait-timeout 180 web worker realtime' "$docker_log"

migration_line=$(grep -n -F 'up --no-build --no-deps migrate' "$docker_log" | cut -d: -f1)
gateway_line=$(grep -n -F 'vpn-gateway-1 vpn-gateway-2 vpn-gateway-3 vpn-gateway-4' "$docker_log" | cut -d: -f1)
application_line=$(grep -n -F 'web worker realtime' "$docker_log" | cut -d: -f1)
(( migration_line < gateway_line && gateway_line < application_line ))

echo 'PASS: production deploy upgrades existing secrets and starts VPN gateways automatically'
