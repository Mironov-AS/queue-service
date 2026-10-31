#!/usr/bin/env bash
# Production release switch for the queue service with the booking channel.
# Uses the rehearsed engine and control adapter; keeps the previous release
# at /opt/queue-service/.switch-previous for a manual rollback.
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || {
	echo 'root required' >&2
	exit 1
}
deploy_dir=$(cd "$(dirname "$0")" && pwd)
candidate=${SWITCH_CANDIDATE:-/opt/queue-service/releases/booking-resize-20261030/server}
export SWITCH_PRODUCTION=1
export SWITCH_LIVE=/opt/queue-service/server
export SWITCH_CANDIDATE=$candidate
export SWITCH_OLD=/opt/queue-service/.switch-previous
export SWITCH_STAGE=/opt/queue-service/.switch-staged
export SWITCH_WORK=/opt/queue-service/.switch-work
export SWITCH_CONTROL=$deploy_dir/prod-control.sh
export SWITCH_UNIT=queue-service.service
export SWITCH_PORT=3001
export SWITCH_DATA_DIR=/opt/queue-data
export SWITCH_ENV_FILE=/opt/queue-service/secrets/booking.env
export SWITCH_DROPIN_DIR=/etc/systemd/system/queue-service.service.d
export SWITCH_NODE_MODULES=/opt/queue-service/server/node_modules
export SWITCH_BACKUP_DIR=/opt/queue-data/backups
[ -x "$SWITCH_CONTROL" ] || {
	echo 'control adapter missing' >&2
	exit 2
}
[ -d "$SWITCH_CANDIDATE" ] || {
	echo 'candidate release missing' >&2
	exit 2
}
echo '--- production state before switch'
systemctl is-active queue-service.service
curl --fail --silent --max-time 5 http://127.0.0.1:3001/api/queue >/dev/null && echo 'queue API responds'
# The engine refuses to run while a previous-release copy exists. Rotate it
# aside instead of deleting it, so an older rollback target stays available.
if [ -e "$SWITCH_OLD" ]; then
	stamp=$(date -u +%Y%m%dT%H%M%SZ)
	mv "$SWITCH_OLD" "${SWITCH_OLD}.$stamp"
	echo "previous release copy rotated to ${SWITCH_OLD}.$stamp"
	# keep the two newest rotated copies only
	mapfile -t rotated < <(ls -1dt "${SWITCH_OLD}".* 2>/dev/null || true)
	for stale in "${rotated[@]:2}"; do
		echo "removing stale rotated copy: $stale"
		rm -rf "$stale"
	done
fi
echo '--- switching'
bash "$deploy_dir/switch-engine-v2.sh"
echo '--- production state after switch'
systemctl is-active queue-service.service
curl --fail --silent --max-time 5 http://127.0.0.1:3001/api/queue >/dev/null && echo 'queue API responds'
code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:3001/api/booking/services)
echo "booking route without token: $code"
[ "$code" = 401 ]
systemctl show queue-service.service -p EnvironmentFiles --value | grep -Fq /opt/queue-service/secrets/booking.env && echo 'booking secret attached'
echo 'PRODUCTION SWITCH COMPLETED'
