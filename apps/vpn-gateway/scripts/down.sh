#!/bin/sh
set -eu

cp "${PUSHDOCS_RESOLV_BACKUP:?}" /etc/resolv.conf
rm -f "${PUSHDOCS_DNS_FILE:?}"
printf 'down\n' > "${PUSHDOCS_STATE_FILE:?}"
