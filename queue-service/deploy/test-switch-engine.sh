#!/usr/bin/env bash
set -euo pipefail
engine=$(realpath "$(dirname "$0")/switch-engine.sh")
root=$(mktemp -d /tmp/queue-switch-test-XXXXXX)
trap 'rm -rf "$root"' EXIT
run_case() {
	local failure=$1 expected=$2
	rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed" "$root/stop-attempt"
	mkdir -p "$root/server/uploads" "$root/candidate" "$root/data"
	echo uploaded >"$root/server/uploads/file"
	touch "$root/.isolated-test"
	echo old >"$root/server/version"
	echo new >"$root/candidate/version"
	echo retained >"$root/data/queue"
	echo running >"$root/state"
	printf '%s' "$failure" >"$root/failure"
	if SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then rc=0; else rc=$?; fi
	[ "$(cat "$root/server/version")" = "$expected" ]
	[ "$(cat "$root/state")" = running ]
	[ "$(cat "$root/data/queue")" = retained ]
	[ "$(cat "$root/server/uploads/file")" = uploaded ]
	if [ "$failure" = none ] || [ "$failure" = late-upload ]; then [ "$rc" = 0 ]; else [ "$rc" != 0 ]; fi
	echo "PASS $failure -> $expected"
}
cat >"$root/control" <<'CONTROL'
#!/usr/bin/env bash
set -eu
root=$(dirname "$0"); action=$1
failure=$(cat "$root/failure")
# One transient failure, including one that already stopped the service.
if [ "$action" = stop ] && { [ "$failure" = stop ] || [ "$failure" = stop-partial ]; } && [ ! -e "$root/stop-attempt" ]; then
 touch "$root/stop-attempt"
 [ "$failure" != stop-partial ] || echo stopped > "$root/state"
 exit 1
fi
if [ "$action" = stop ] && [ "$failure" = rollback-stop ]; then
 [ "$(cat "$root/server/version")" = new ] && exit 1
fi
if [ "$action" = check-new ] && [ "$failure" = rollback-stop ]; then exit 1; fi
if [ "$action" = check-new ] && [ "$failure" = rollback-upload ]; then
 echo created-after-switch > "$root/server/uploads/new"
 exit 1
fi
if [ "$action" = check-new ] && [ "$failure" = rollback-conflict ]; then
 echo changed-after-switch > "$root/server/uploads/file"
 exit 1
fi
if [ "$action" = check-new ] && [ "$failure" = rollback-type-conflict ]; then
 rm "$root/server/uploads/file"; mkdir "$root/server/uploads/file"
 echo new > "$root/server/uploads/file/child"; exit 1
fi
if [ "$action" = check-new ] && [ "$failure" = rollback-symlink ]; then
 ln -s /tmp "$root/server/uploads/link"; exit 1
fi
if [ "$action" = "$failure" ] && [ "$action" != stop ]; then exit 1; fi
case "$action" in
 validate) test -f "$2/version";;
 snapshot) :;;
 stop) echo stopped > "$root/state"; [ "$failure" != late-upload ] || echo late > "$root/server/uploads/late";;
 start) echo running > "$root/state";;
 check-old) test "$(cat "$root/server/version")" = old && test "$(cat "$root/state")" = running;;
 check-new) test "$(cat "$root/server/version")" = new && test "$(cat "$root/state")" = running;;
esac
CONTROL
chmod +x "$root/control"
run_case validate old
run_case snapshot old
run_case stop old
run_case stop-partial old
run_case check-new old
run_case rollback-upload old
test "$(cat "$root/server/uploads/new")" = created-after-switch
echo 'PASS rollback preserves uploads created by candidate'
# Conflict must leave both versions intact and the stopped candidate accessible.
rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed"
mkdir -p "$root/server/uploads" "$root/candidate" "$root/data"
echo old >"$root/server/version"
echo new >"$root/candidate/version"
echo uploaded >"$root/server/uploads/file"
echo running >"$root/state"
echo rollback-conflict >"$root/failure"
if SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then exit 1; fi
grep -q 'ROLLBACK HALTED: conflicting upload' "$root/result"
test "$(cat "$root/server/uploads/file")" = changed-after-switch
test "$(cat "$root/previous/uploads/file")" = uploaded
test "$(cat "$root/state")" = stopped
echo 'PASS conflicting uploads retain both versions without overwriting'
for failure in rollback-type-conflict rollback-symlink; do
	rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed"
	mkdir -p "$root/server/uploads" "$root/candidate"
	echo old >"$root/server/version"
	echo new >"$root/candidate/version"
	echo uploaded >"$root/server/uploads/file"
	echo running >"$root/state"
	echo "$failure" >"$root/failure"
	if SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then exit 1; fi
	grep -q 'ROLLBACK HALTED:' "$root/result"
	test "$(cat "$root/previous/uploads/file")" = uploaded
	test "$(cat "$root/server/version")" = new
	test "$(cat "$root/state")" = stopped
	echo "PASS $failure retains both versions"
done
# If stopping the new process fails, retain both versions and never rename live code.
run_case rollback-stop new
grep -q 'ROLLBACK HALTED' "$root/result"
test "$(cat "$root/previous/version")" = old
test ! -e "$root/failed"
echo 'PASS rollback refuses to move code while stop is unconfirmed'
run_case none new
# The stop hook models an upload completed after staging but before the stop.
run_case late-upload new
test "$(cat "$root/server/uploads/late")" = late
echo 'PASS uploads completed during staging preserved'
if SWITCH_TEST_ROOT=/opt/queue-service bash "$engine" >/dev/null 2>&1; then
	echo 'guard failed' >&2
	exit 1
fi
echo 'PASS production path rejected'
