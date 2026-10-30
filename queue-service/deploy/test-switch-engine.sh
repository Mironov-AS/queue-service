#!/usr/bin/env bash
set -euo pipefail
engine=$(realpath "$(dirname "$0")/switch-engine.sh")
root=$(mktemp -d /tmp/queue-switch-test-XXXXXX)
trap 'rm -rf "$root"' EXIT
run_case() {
	local failure=$1 expected=$2
	rm -rf "$root/server" "$root/candidate" "$root/previous" "$root/staged" "$root/failed"
	mkdir -p "$root/server" "$root/candidate" "$root/data"
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
	if [ "$failure" = none ]; then [ "$rc" = 0 ]; else [ "$rc" != 0 ]; fi
	echo "PASS $failure -> $expected"
}
cat >"$root/control" <<'CONTROL'
#!/usr/bin/env bash
set -eu
root=$(dirname "$0"); action=$1
failure=$(cat "$root/failure")
# Simulate systemctl stopping the process but reporting failure.
if [ "$action" = stop ] && [ "$failure" = stop-partial ]; then
 echo stopped > "$root/state"
 exit 1
fi
if [ "$action" = "$failure" ]; then exit 1; fi
case "$action" in
 validate) test -f "$2/version";;
 snapshot) :;;
 stop) echo stopped > "$root/state";;
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
run_case none new
if SWITCH_TEST_ROOT=/opt/queue-service bash "$engine" >/dev/null 2>&1; then
	echo 'guard failed' >&2
	exit 1
fi
echo 'PASS production path rejected'
