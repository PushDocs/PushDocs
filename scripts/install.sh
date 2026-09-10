#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=${PUSHDOCS_ENV_FILE:-.env}
public_origin=""
prepare_only=0

usage() {
  echo "Usage: ./scripts/install.sh https://docs.example.com [--prepare-only]" >&2
}

for argument in "$@"; do
  case "$argument" in
    --prepare-only)
      prepare_only=1
      ;;
    http://*|https://*)
      if [[ -n "$public_origin" ]]; then
        usage
        exit 2
      fi
      public_origin=$argument
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is missing: $1" >&2
    exit 1
  fi
}

require_setting() {
  if ! grep -q "^$1=" "$env_file"; then
    echo "$env_file is missing $1" >&2
    exit 1
  fi
}

if [[ -e "$env_file" && ! -f "$env_file" ]]; then
  echo "$env_file exists but is not a regular file" >&2
  exit 1
fi

if [[ -f "$env_file" ]]; then
  for setting in \
    POSTGRES_PASSWORD \
    PUSHDOCS_PUBLIC_ORIGIN \
    PUSHDOCS_SESSION_PEPPER \
    PUSHDOCS_ENCRYPTION_KEY; do
    require_setting "$setting"
  done
  chmod 600 "$env_file"
  echo "Using the existing $env_file. Secrets were not changed."
else
  if [[ -z "$public_origin" ]]; then
    usage
    exit 2
  fi

  authority=${public_origin#*://}
  if [[ -z "$authority" || "$authority" == */* || "$authority" == *\?* || "$authority" == *\#* || "$authority" == *@* ]]; then
    echo "The public origin must contain only a scheme and host, with an optional port." >&2
    exit 2
  fi

  case "$public_origin" in
    https://*:*)
      echo "Use the default HTTPS port for the first production installation." >&2
      exit 2
      ;;
    https://*)
      caddy_address=$authority
      http_port=80
      https_port=443
      ;;
    http://localhost|http://127.0.0.1)
      caddy_address=:80
      http_port=8080
      https_port=8443
      ;;
    http://localhost:*|http://127.0.0.1:*)
      caddy_address=:80
      http_port=${authority##*:}
      if [[ ! "$http_port" =~ ^[0-9]+$ || "$http_port" -lt 1 || "$http_port" -gt 65535 ]]; then
        echo "The localhost port must be a number from 1 to 65535." >&2
        exit 2
      fi
      https_port=8443
      ;;
    *)
      echo "Production installations require HTTPS. Plain HTTP is allowed only on localhost." >&2
      exit 2
      ;;
  esac

  require_command openssl
  env_directory=$(dirname "$env_file")
  if [[ ! -d "$env_directory" ]]; then
    echo "Environment file directory does not exist: $env_directory" >&2
    exit 1
  fi

  umask 077
  temporary_file=$(mktemp "${env_file}.tmp.XXXXXX")
  cleanup() {
    rm -f "$temporary_file"
  }
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT
  trap 'cleanup; exit 143' TERM

  postgres_password=$(openssl rand -hex 32)
  session_pepper=$(openssl rand -hex 32)
  encryption_key=$(openssl rand -base64 32)
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'PUSHDOCS_PUBLIC_ORIGIN=%s\n' "$public_origin"
    printf 'PUSHDOCS_SESSION_PEPPER=%s\n' "$session_pepper"
    printf 'PUSHDOCS_ENCRYPTION_KEY=%s\n' "$encryption_key"
    printf 'PUSHDOCS_ADDRESS=%s\n' "$caddy_address"
    printf 'PUSHDOCS_HTTP_PORT=%s\n' "$http_port"
    printf 'PUSHDOCS_HTTPS_PORT=%s\n' "$https_port"
  } > "$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$env_file"
  trap - EXIT INT TERM
  echo "Created $env_file with installation secrets. Back it up in a separate secure location."
fi

if [[ "$prepare_only" == 1 ]]; then
  exit 0
fi

require_command docker
docker compose --env-file "$env_file" up --build --detach --wait
echo "PushDocs is ready. Open the configured public origin to create the first operator."
