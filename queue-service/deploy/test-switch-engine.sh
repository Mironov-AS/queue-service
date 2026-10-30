#!/usr/bin/env bash
set -euo pipefail
engine=$(realpath "$(dirname "$0")/switch-engine.sh")
root=$(mktemp -d /tmp/queue-switch-test-XXXXXX)
trap 'rm -rf "$root"' EXIT
run_case() {
	local failure=$1 expected=$2
	rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed" "$root/stop-attempt"
	mkdir -p "$root/server/uploads" "$root/candidate" "$root/data"
	chmod 750 "$root/server/uploads"
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
	[ "$(stat -c '%a' "$root/server/uploads")" = 750 ]
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
if [ "$action" = stop ] && [ "$failure" = missing-uploads ] && [ ! -e "$root/stop-attempt" ]; then
 touch "$root/stop-attempt"; mv "$root/server/uploads" "$root/saved-uploads"; echo stopped > "$root/state"; exit 0
fi
if [ "$action" = start ] && [ "$failure" = missing-uploads ] && [ -d "$root/saved-uploads" ]; then
 mv "$root/saved-uploads" "$root/server/uploads"
fi
if [ "$action" = check-new ] && [ "$failure" = rollback-stop ]; then exit 1; fi
if [ "$action" = check-new ] && [ "$failure" = rollback-missing-uploads ]; then
 mv "$root/server/uploads" "$root/hidden-candidate-uploads"
 exit 1
fi
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
run_case missing-uploads old
# A failed find must fail closed, even when it produced no output.
mkdir -p "$root/fakebin"
printf '#!/bin/sh\nexit 1\n' >"$root/fakebin/find"
chmod +x "$root/fakebin/find"
# Inspect the failure and unchanged live version.
rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed"
mkdir -p "$root/server/uploads" "$root/candidate"
echo old >"$root/server/version"
echo new >"$root/candidate/version"
echo running >"$root/state"
echo none >"$root/failure"
if PATH="$root/fakebin:$PATH" SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then exit 1; fi
grep -q 'missing or unsafe live uploads tree' "$root/result"
test "$(cat "$root/server/version")" = old
test "$(cat "$root/state")" = running
echo 'PASS failed traversal rejected'
run_case check-new old
# Fail specifically at rollback manifest traversal, after the safety scan succeeds.
printf '#!/bin/sh\ncase " $* " in *" -mindepth "*) exit 1;; esac\nexec /usr/bin/find "$@"\n' >"$root/fakebin/find"
chmod +x "$root/fakebin/find"
rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed"
mkdir -p "$root/server/uploads" "$root/candidate"
echo old >"$root/server/version"
echo new >"$root/candidate/version"
echo uploaded >"$root/server/uploads/file"
echo running >"$root/state"
echo check-new >"$root/failure"
if PATH="$root/fakebin:$PATH" SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then exit 1; fi
grep -q 'ROLLBACK HALTED: upload traversal failed' "$root/result"
test "$(cat "$root/server/version")" = new
test "$(cat "$root/previous/version")" = old
test "$(cat "$root/state")" = stopped
echo 'PASS rollback manifest traversal failure preserves both versions'
# A candidate missing uploads must halt, not silently abandon possible data.
rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed" "$root/hidden-candidate-uploads"
mkdir -p "$root/server/uploads" "$root/candidate"
echo old >"$root/server/version"
echo new >"$root/candidate/version"
echo uploaded >"$root/server/uploads/file"
echo running >"$root/state"
echo rollback-missing-uploads >"$root/failure"
if SWITCH_TEST_ROOT="$root" bash "$engine" >"$root/result" 2>&1; then exit 1; fi
grep -q 'ROLLBACK HALTED: candidate uploads missing or unsafe' "$root/result"
test "$(cat "$root/server/version")" = new
test "$(cat "$root/previous/version")" = old
test "$(cat "$root/state")" = stopped
echo 'PASS missing candidate uploads halt rollback'
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
