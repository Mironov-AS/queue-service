#!/bin/bash
set -euo pipefail
root=$(realpath "${SWITCH_TEST_ROOT:?}")
unit=${SWITCH_TEST_UNIT:?}
case "$root" in /opt/queue-switch-test-*|/tmp/queue-switch-test-*) ;; *) echo 'unsafe root' >&2; exit 2;; esac
[[ "$unit" =~ ^queue-switch-test-[a-z0-9-]+\.service$ ]] || exit 2
[ -f "$root/.isolated-test" ] && [ ! -L "$root/.isolated-test" ] || exit 2
dropin=/etc/systemd/system/$unit.d
if [ "$1" = start ]; then
  if [ -d "$root/previous" ]; then
    install -d -m 755 "$dropin"
    if [ -f "$root/fail-write" ]; then rm "$root/fail-write"; echo 'injected drop-in write failure' >&2; exit 1; fi
    printf '[Service]\nEnvironmentFile=%s/booking.env\n' "$root" > "$dropin/booking.conf"
  else
    rm -f -- "$dropin/booking.conf"
    rmdir --ignore-fail-on-non-empty "$dropin" 2>/dev/null || true
  fi
  if [ -f "$root/fail-reload" ]; then rm "$root/fail-reload"; echo 'injected daemon-reload failure' >&2; exit 1; fi
  systemctl daemon-reload
fi
if [ "$1" = check-new ] && [ -f "$root/fail-new" ]; then exit 1; fi
if [ "$1" = check-old ]; then
  [ ! -e "$dropin/booking.conf" ] || exit 1
  ! systemctl show "$unit" -p EnvironmentFiles --value | grep -Fq "$root/booking.env" || exit 1
fi
if [ "$1" = check-new ]; then
  [ -f "$dropin/booking.conf" ] || exit 1
  systemctl show "$unit" -p EnvironmentFiles --value | grep -Fq "$root/booking.env" || exit 1
fi
exec bash "$root/adapter" "$@"
