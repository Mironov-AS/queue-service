#!/usr/bin/env bash
# EXPERIMENTAL: isolated rehearsal only; refuses real paths and real service.
set -Eeuo pipefail
: "${SWITCH_TEST_ROOT:?Требуется изолированный тестовый каталог}"
root=$(realpath "$SWITCH_TEST_ROOT")
case "$root" in /tmp/queue-switch-test-*) ;; *)
	echo 'Отклонён небезопасный каталог' >&2
	exit 2
	;;
esac
[ -f "$root/.isolated-test" ] && [ ! -L "$root/.isolated-test" ] || exit 2
live="$root/server"
candidate="$root/candidate"
old="$root/previous"
stage="$root/staged"
[ -d "$live" ] && [ -d "$candidate" ] && [ ! -e "$old" ] && [ ! -e "$stage" ] || exit 2
phase=preflight
rollback() {
	status=$?
	trap - ERR
	if [ "$phase" = stopped ] || [ "$phase" = switched ]; then
		"$root/control" stop || true
		if [ -d "$old" ]; then
			if [ -e "$live" ]; then mv "$live" "$root/failed" || exit 3; fi
			mv "$old" "$live" || exit 3
		fi
		"$root/control" start || exit 3
		"$root/control" check-old || exit 3
		echo 'ROLLBACK VERIFIED'
	fi
	exit "$status"
}
trap rollback ERR
# Copy and validate before stopping; no rollback uses a partial archive.
cp -a "$candidate" "$stage"
"$root/control" validate "$stage"
"$root/control" snapshot
"$root/control" stop
phase=stopped
mv "$live" "$old"
mv "$stage" "$live"
phase=switched
"$root/control" start
"$root/control" check-new
phase=done
trap - ERR
echo 'SWITCH VERIFIED'
