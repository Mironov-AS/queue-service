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
regular_upload_tree() {
	local unexpected
	[ -d "$1" ] && [ ! -L "$1" ] || return 1
	# A failed traversal must not be mistaken for an empty, safe tree.
	unexpected=$(find "$1" ! -type d ! -type f -print -quit) || return 1
	[ -z "$unexpected" ]
}
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
			if [ -d "$live/uploads" ]; then
				regular_upload_tree "$live/uploads" && regular_upload_tree "$old/uploads" || {
					echo 'ROLLBACK HALTED: uploads paths unsafe' >&2
					exit 3
				}
				# Process substitution hides find's exit status; build and verify a
				# complete manifest before inspecting or copying any upload.
				manifest=$(mktemp "$root/.uploads-manifest.XXXXXX") || exit 3
				if ! find "$live/uploads" -mindepth 1 -print0 >"$manifest"; then
					rm -f "$manifest"
					echo 'ROLLBACK HALTED: upload traversal failed' >&2
					exit 3
				fi
				while IFS= read -r -d '' entry; do
					rel=${entry#"$live/uploads/"}
					target="$old/uploads/$rel"
					if [ -e "$target" ]; then
						if { [ -d "$entry" ] && [ ! -d "$target" ]; } || { [ -f "$entry" ] && { [ ! -f "$target" ] || ! cmp -s "$entry" "$target"; }; }; then
							echo 'ROLLBACK HALTED: conflicting upload' >&2
							exit 3
						fi
					fi
				done <"$manifest"
				cp -an "$live/uploads/." "$old/uploads/" || exit 3
				while IFS= read -r -d '' file; do
					[ -f "$file" ] || continue
					rel=${file#"$live/uploads/"}
					cmp -s "$file" "$old/uploads/$rel" || {
						echo 'ROLLBACK HALTED: upload verification failed' >&2
						exit 3
					}
				done <"$manifest"
				rm -f "$manifest"
			fi
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
# The service requires this path. Missing or unsafe trees must not be silently
# treated as an empty tree, nor can a release be switched without preserving it.
regular_upload_tree "$live/uploads" || {
	echo 'missing or unsafe live uploads tree' >&2
	false
}
# Capture any uploads made after staging, only once writers are stopped.
if [ -d "$live/uploads" ]; then
	regular_upload_tree "$live/uploads" || {
		echo 'unsafe uploads tree' >&2
		false
	}
	if [ -e "$stage/uploads" ] || [ -L "$stage/uploads" ]; then
		regular_upload_tree "$stage/uploads" || {
			echo 'unsafe staged uploads tree' >&2
			false
		}
	fi
	if [ ! -e "$stage/uploads" ]; then
		cp -a "$live/uploads" "$stage/uploads"
	else
		cp -a "$live/uploads/." "$stage/uploads/"
		# cp of contents alone does not preserve the upload root's metadata.
		chown --reference="$live/uploads" "$stage/uploads"
		chmod --reference="$live/uploads" "$stage/uploads"
		touch -r "$live/uploads" "$stage/uploads"
	fi
	diff -qr "$live/uploads" "$stage/uploads"
	[ "$(stat -c '%u:%g:%a' "$live/uploads")" = "$(stat -c '%u:%g:%a' "$stage/uploads")" ]
fi
mv "$live" "$old"
mv "$stage" "$live"
phase=switched
"$root/control" start
"$root/control" check-new
phase=done
trap - ERR
echo 'SWITCH VERIFIED'
