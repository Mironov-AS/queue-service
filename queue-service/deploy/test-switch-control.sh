#!/usr/bin/env bash
set -euo pipefail
adapter=$(realpath "$(dirname "$0")/switch-control-rehearsal.sh")
root=$(mktemp -d /tmp/queue-switch-test-control-XXXXXX)
trap 'rm -rf "$root"' EXIT
mkdir "$root/bin" "$root/staged" "$root/staged/node_modules"
touch "$root/.isolated-test"
echo test >"$root/staged/index.js"
cat >"$root/bin/systemctl" <<'SH'
#!/bin/bash
case "$1" in stop) exit "${MOCK_STOP_RC:-0}";; show) case "$4" in ActiveState) echo "${MOCK_STATE:-inactive}";; MainPID) echo "${MOCK_PID:-0}";; esac;; is-active|start) exit 0;; *) exit 1;; esac
SH
chmod +x "$root/bin/systemctl"
cat >"$root/bin/curl" <<'SH'
#!/bin/bash
case " $* " in *"/api/booking/services"*) printf '%s' "${MOCK_BOOKING_CODE:-401}";; *) exit 0;; esac
SH
printf '#!/bin/sh\nexit 0\n' >"$root/bin/sleep"
chmod +x "$root/bin/curl" "$root/bin/sleep"
export PATH="$root/bin:$PATH" SWITCH_TEST_ROOT="$root" SWITCH_TEST_UNIT=queue-switch-test-control.service SWITCH_TEST_PORT=13085
bash "$adapter" validate "$root/staged"
bash "$adapter" stop
if MOCK_STATE=active bash "$adapter" stop; then
	echo 'active stop accepted' >&2
	exit 1
fi
if MOCK_PID=123 bash "$adapter" stop; then
	echo 'running pid accepted' >&2
	exit 1
fi
if MOCK_STOP_RC=1 bash "$adapter" stop; then
	echo 'failed stop accepted' >&2
	exit 1
fi
if SWITCH_TEST_UNIT=queue-service.service bash "$adapter" stop; then
	echo 'production unit accepted' >&2
	exit 1
fi
if SWITCH_TEST_ROOT=/opt/queue-service bash "$adapter" stop; then
	echo 'production root accepted' >&2
	exit 1
fi
if SWITCH_TEST_PORT=3001 bash "$adapter" check-new; then
	echo 'production port accepted' >&2
	exit 1
fi
MOCK_BOOKING_CODE=401 bash "$adapter" check-new
if MOCK_BOOKING_CODE=503 bash "$adapter" check-new; then
	echo 'disabled booking incorrectly accepted as ready' >&2
	exit 1
fi
MOCK_BOOKING_CODE=503 bash "$adapter" check-old
echo 'PASS isolated adapter guards, stop confirmation and booking fail-closed readiness'
