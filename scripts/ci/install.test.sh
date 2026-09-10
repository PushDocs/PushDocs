#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
temporary_root=${TMPDIR:-/tmp}
temporary_root=${temporary_root%/}
temporary_directory=$(mktemp -d "$temporary_root/pushdocs-install.XXXXXX")
environment_file="$temporary_directory/pushdocs.env"

cleanup() {
  case "$temporary_directory" in
    "$temporary_root"/pushdocs-install.*)
      rm -rf -- "$temporary_directory"
      ;;
    *)
      echo "Refusing to remove unexpected test path: $temporary_directory" >&2
      exit 1
      ;;
  esac
}
trap cleanup EXIT

PUSHDOCS_ENV_FILE="$environment_file" ./scripts/install.sh \
  https://docs.example.com --prepare-only
first_hash=$(openssl dgst -sha256 "$environment_file")
PUSHDOCS_ENV_FILE="$environment_file" ./scripts/install.sh --prepare-only
second_hash=$(openssl dgst -sha256 "$environment_file")
[[ "$first_hash" == "$second_hash" ]]

if mode=$(stat -c '%a' "$environment_file" 2>/dev/null); then
  :
else
  mode=$(stat -f '%Lp' "$environment_file")
fi
[[ "$mode" == 600 ]]

postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$environment_file")
session_pepper=$(sed -n 's/^PUSHDOCS_SESSION_PEPPER=//p' "$environment_file")
encryption_key=$(sed -n 's/^PUSHDOCS_ENCRYPTION_KEY=//p' "$environment_file")
[[ ${#postgres_password} == 64 ]]
[[ ${#session_pepper} == 64 ]]
decoded_key_length=$(printf '%s' "$encryption_key" | openssl base64 -d -A | wc -c | tr -d ' ')
[[ "$decoded_key_length" == 32 ]]

grep -q '^PUSHDOCS_PUBLIC_ORIGIN=https://docs.example.com$' "$environment_file"
grep -q '^PUSHDOCS_ADDRESS=docs.example.com$' "$environment_file"
grep -q '^PUSHDOCS_HTTP_PORT=80$' "$environment_file"
grep -q '^PUSHDOCS_HTTPS_PORT=443$' "$environment_file"
docker compose --env-file "$environment_file" config --quiet

invalid_file="$temporary_directory/invalid.env"
if PUSHDOCS_ENV_FILE="$invalid_file" ./scripts/install.sh \
  http://docs.example.com --prepare-only > /dev/null 2>&1; then
  echo "The installer accepted a non-HTTPS production origin" >&2
  exit 1
fi
[[ ! -e "$invalid_file" ]]

echo "PASS: installation secrets are valid, private and stable across reruns"
