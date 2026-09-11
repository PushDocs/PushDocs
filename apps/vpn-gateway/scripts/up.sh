#!/bin/sh
set -eu

dns_file="${PUSHDOCS_DNS_FILE:?}"
resolv_backup="${PUSHDOCS_RESOLV_BACKUP:?}"
state_file="${PUSHDOCS_STATE_FILE:?}"
temporary_dns="${dns_file}.tmp"

env | awk -F= '
  $1 ~ /^foreign_option_[0-9]+$/ {
    sub(/^[^=]*=/, "", $0)
    split($0, option, /[[:space:]]+/)
    if (option[1] == "dhcp-option" && option[2] == "DNS" && option[3] ~ /^([0-9]{1,3}\.){3}[0-9]{1,3}$/) {
      print "nameserver " option[3]
    }
  }
' > "$temporary_dns"

if [ -s "$temporary_dns" ]; then
  cp "$temporary_dns" /etc/resolv.conf
else
  cp "$resolv_backup" /etc/resolv.conf
fi
mv "$temporary_dns" "$dns_file"
printf 'up\n' > "$state_file"
