#!/usr/bin/env bash
# EXPERIMENTAL: isolated rehearsal only; refuses real paths and real service.
set -Eeuo pipefail
: "${SWITCH_TEST_ROOT:?Требуется изолированный тестовый каталог}"
root=$(realpath "$SWITCH_TEST_ROOT")
case "$root" in /tmp/queue-switch-test-* | /opt/queue-switch-test-*) ;; *)
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
	if [ "$phase" = stopping ] || [ "$phase" = stopped ] || [ "$phase" = switched ]; then
		if ! "$root/control" stop; then
			echo 'ROLLBACK HALTED: service stop not confirmed; directories untouched' >&2
			exit 3
		fi
		if [ -d "$old" ]; then
			[ ! -e "$root/failed" ] || {
				echo 'ROLLBACK HALTED: failed directory already exists' >&2
				exit 3
			}
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
# A failed stop can still have stopped the service; recovery must begin before it.
phase=stopping
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
