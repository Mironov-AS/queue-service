#!/usr/bin/env bash
# Release switch engine. The same file performs isolated rehearsals and the
# production switch; the paths are validated before anything is touched.
set -Eeuo pipefail
: "${SWITCH_LIVE:?}" "${SWITCH_CANDIDATE:?}" "${SWITCH_OLD:?}" "${SWITCH_STAGE:?}" "${SWITCH_CONTROL:?}" "${SWITCH_WORK:?}"
[ "$(id -u)" = 0 ] || {
	echo 'root required' >&2
	exit 1
}
realpath_one() {
	realpath -m -- "$1"
}
LIVE=$(realpath_one "$SWITCH_LIVE")
CANDIDATE=$(realpath_one "$SWITCH_CANDIDATE")
OLD=$(realpath_one "$SWITCH_OLD")
STAGE=$(realpath_one "$SWITCH_STAGE")
WORK=$(realpath_one "$SWITCH_WORK")
CONTROL=$(realpath_one "$SWITCH_CONTROL")
if [ "${SWITCH_PRODUCTION:-0}" = 1 ]; then
	[ "$LIVE" = /opt/queue-service/server ] &&
		[ "$OLD" = /opt/queue-service/.switch-previous ] &&
		[ "$STAGE" = /opt/queue-service/.switch-staged ] &&
		[ "$WORK" = /opt/queue-service/.switch-work ] &&
		case "$CANDIDATE" in /opt/queue-service/releases/*) ;; *) false ;; esac || {
		echo 'production path mismatch' >&2
		exit 2
	}
else
	case "$LIVE$CANDIDATE$OLD$STAGE$WORK" in
	*/queue-switch-test-* | /tmp/queue-switch-test-*) ;;
	*)
		echo 'Отклонён небезопасный каталог' >&2
		exit 2
		;;
	esac
fi
[ -x "$CONTROL" ] || {
	echo 'control adapter missing' >&2
	exit 2
}
mkdir -p "$WORK"
[ -d "$LIVE" ] && [ -d "$CANDIDATE" ] && [ ! -e "$OLD" ] && [ ! -e "$STAGE" ] || exit 2
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
		if ! "$CONTROL" stop; then
			echo 'ROLLBACK HALTED: service stop not confirmed; directories untouched' >&2
			exit 3
		fi
		if [ -d "$OLD" ]; then
			[ ! -e "$LIVE.failed" ] || {
				echo 'ROLLBACK HALTED: failed directory already exists' >&2
				exit 3
			}
			# A present candidate without its upload tree is not evidence that
			# there were no new uploads; do not silently roll back over it.
			if [ -e "$LIVE" ] && ! regular_upload_tree "$LIVE/uploads"; then
				echo 'ROLLBACK HALTED: candidate uploads missing or unsafe' >&2
				exit 3
			fi
			if [ -d "$LIVE/uploads" ]; then
				regular_upload_tree "$LIVE/uploads" && regular_upload_tree "$OLD/uploads" || {
					echo 'ROLLBACK HALTED: uploads paths unsafe' >&2
					exit 3
				}
				# Process substitution hides find's exit status; build and verify a
				# complete manifest before inspecting or copying any upload.
				manifest=$(mktemp "$WORK/uploads-manifest.XXXXXX") || exit 3
				if ! find "$LIVE/uploads" -mindepth 1 -print0 >"$manifest"; then
					rm -f "$manifest"
					echo 'ROLLBACK HALTED: upload traversal failed' >&2
					exit 3
				fi
				while IFS= read -r -d '' entry; do
					rel=${entry#"$LIVE/uploads/"}
					target="$OLD/uploads/$rel"
					if [ -e "$target" ]; then
						if { [ -d "$entry" ] && [ ! -d "$target" ]; } || { [ -f "$entry" ] && { [ ! -f "$target" ] || ! cmp -s "$entry" "$target"; }; }; then
							echo 'ROLLBACK HALTED: conflicting upload' >&2
							exit 3
						fi
					fi
				done <"$manifest"
				cp -an "$LIVE/uploads/." "$OLD/uploads/" || exit 3
				while IFS= read -r -d '' file; do
					[ -f "$file" ] || continue
					rel=${file#"$LIVE/uploads/"}
					cmp -s "$file" "$OLD/uploads/$rel" || {
						echo 'ROLLBACK HALTED: upload verification failed' >&2
						exit 3
					}
				done <"$manifest"
				rm -f "$manifest"
			fi
			if [ -e "$LIVE" ]; then mv "$LIVE" "$LIVE.failed" || exit 3; fi
			mv "$OLD" "$LIVE" || exit 3
		fi
		# The old release must run without the booking secret attached.
		"$CONTROL" env-disable || exit 3
		"$CONTROL" start || exit 3
		"$CONTROL" check-old || exit 3
		echo 'ROLLBACK VERIFIED'
	fi
	exit "$status"
}
trap rollback ERR
# Copy and validate before stopping; no rollback uses a partial copy.
cp -a "$CANDIDATE" "$STAGE"
# The staged tree must stay readable by the service account even when the
# candidate was uploaded by another user; the uploads subtree keeps its own
# metadata and is handled separately below.
live_owner=$(stat -c %U "$LIVE")
live_group=$(stat -c %G "$LIVE")
find "$STAGE" -path "$STAGE/uploads" -prune -o -exec chown "$live_owner:$live_group" {} +
"$CONTROL" validate "$STAGE"
"$CONTROL" snapshot
# A failed stop can still have stopped the service; recovery must begin before it.
phase=stopping
"$CONTROL" stop
phase=stopped
# The service requires this path. Missing or unsafe trees must not be silently
# treated as an empty tree, nor can a release be switched without preserving it.
regular_upload_tree "$LIVE/uploads" || {
	echo 'missing or unsafe live uploads tree' >&2
	false
}
# Capture any uploads made after staging, only once writers are stopped.
if [ -d "$LIVE/uploads" ]; then
	if [ -e "$STAGE/uploads" ] || [ -L "$STAGE/uploads" ]; then
		regular_upload_tree "$STAGE/uploads" || {
			echo 'unsafe staged uploads tree' >&2
			false
		}
	fi
	if [ ! -e "$STAGE/uploads" ]; then
		cp -a "$LIVE/uploads" "$STAGE/uploads"
	else
		cp -a "$LIVE/uploads/." "$STAGE/uploads/"
		# cp of contents alone does not preserve the upload root's metadata.
		chown --reference="$LIVE/uploads" "$STAGE/uploads"
		chmod --reference="$LIVE/uploads" "$STAGE/uploads"
		touch -r "$LIVE/uploads" "$STAGE/uploads"
	fi
	diff -qr "$LIVE/uploads" "$STAGE/uploads"
	[ "$(stat -c '%u:%g:%a' "$LIVE/uploads")" = "$(stat -c '%u:%g:%a' "$STAGE/uploads")" ]
fi
mv "$LIVE" "$OLD"
mv "$STAGE" "$LIVE"
phase=switched
"$CONTROL" env-enable
"$CONTROL" start
"$CONTROL" check-new
phase=done
trap - ERR
echo 'SWITCH VERIFIED'
