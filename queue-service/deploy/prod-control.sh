#!/usr/bin/env bash
# Control adapter for the release switch. The same file is used in isolated
# rehearsals and in production; only the paths differ and are checked.
set -Eeuo pipefail
[ "$(id -u)" = 0 ] || {
	echo 'root required' >&2
	exit 1
}
UNIT=${SWITCH_UNIT:-queue-service.service}
PORT=${SWITCH_PORT:-3001}
DATA_DIR=${SWITCH_DATA_DIR:-/opt/queue-data}
ENV_FILE=${SWITCH_ENV_FILE:-/opt/queue-service/secrets/booking.env}
DROPIN_DIR=${SWITCH_DROPIN_DIR:-/etc/systemd/system/$UNIT.d}
NODE_MODULES=${SWITCH_NODE_MODULES:-/opt/queue-service/server/node_modules}
BACKUP_DIR=${SWITCH_BACKUP_DIR:-$DATA_DIR/backups}
DB=$DATA_DIR/queue.db
if [ "${SWITCH_PRODUCTION:-0}" = 1 ]; then
	[ "$UNIT" = queue-service.service ] &&
		[ "$PORT" = 3001 ] &&
		[ "$DATA_DIR" = /opt/queue-data ] &&
		[ "$ENV_FILE" = /opt/queue-service/secrets/booking.env ] &&
		[ "$DROPIN_DIR" = /etc/systemd/system/queue-service.service.d ] &&
		[ "$NODE_MODULES" = /opt/queue-service/server/node_modules ] &&
		[ "$BACKUP_DIR" = /opt/queue-data/backups ] || {
		echo 'production path mismatch' >&2
		exit 2
	}
else
	[ "$UNIT" != queue-service.service ] || {
		echo 'isolated mode must not touch the production unit' >&2
		exit 2
	}
fi
http_code() {
	curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT$1" || true
}
case "${1:-}" in
validate)
	[ -s "$2/index.js" ] && [ -d "$2/node_modules" ] && [ -s "$2/database.js" ]
	;;
snapshot)
	# Queue backups contain personal data; never inherit a permissive umask.
	umask 077
	[ -f "$DB" ] || {
		echo 'queue database missing' >&2
		exit 1
	}
	mkdir -p "$BACKUP_DIR"
	chmod 700 "$BACKUP_DIR"
	target=$BACKUP_DIR/queue-switch-$(date -u +%Y%m%dT%H%M%SZ).db
	[ ! -e "$target" ] || exit 1
	node -e '
const Database=require(process.argv[1]+"/better-sqlite3");
const db=new Database(process.argv[2],{readonly:true,fileMustExist:true});
db.backup(process.argv[3]).then(()=>db.close()).catch(e=>{console.error(e);process.exit(1)});
' "$NODE_MODULES" "$DB" "$target"
	[ -s "$target" ]
	chmod 600 "$target"
	chown root:root "$target"
	node -e '
const Database=require(process.argv[1]+"/better-sqlite3");
const db=new Database(process.argv[2],{readonly:true,fileMustExist:true});
if(db.pragma("integrity_check",{simple:true})!=="ok")throw Error("integrity check failed");
console.log("snapshot tickets",db.prepare("select count(*) n from tickets").get().n);
db.close();
' "$NODE_MODULES" "$target"
	echo "snapshot $target"
	;;
stop)
	systemctl stop "$UNIT"
	# A unit may end up in "failed" after a clean stop; what matters is that
	# the process is gone and the port is released.
	state=$(systemctl show "$UNIT" -p ActiveState --value)
	case "$state" in inactive | failed) ;; *) exit 1 ;; esac
	[ "$(systemctl show "$UNIT" -p MainPID --value)" = 0 ] || exit 1
	for _ in $(seq 1 40); do
		ss -ltn | grep -q ":$PORT " || exit 0
		sleep .25
	done
	exit 1
	;;
start)
	systemctl start "$UNIT"
	;;
env-enable)
	[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || {
		echo 'booking secret missing' >&2
		exit 1
	}
	install -d -m 755 "$DROPIN_DIR"
	printf '[Service]\nEnvironmentFile=%s\n' "$ENV_FILE" >"$DROPIN_DIR/booking.conf"
	chmod 644 "$DROPIN_DIR/booking.conf"
	systemctl daemon-reload
	;;
env-disable)
	rm -f "$DROPIN_DIR/booking.conf"
	rmdir --ignore-fail-on-non-empty "$DROPIN_DIR" 2>/dev/null || true
	systemctl daemon-reload
	;;
check-old)
	for _ in $(seq 1 80); do
		systemctl is-active --quiet "$UNIT" || exit 1
		[ "$(http_code /api/queue)" = 200 ] && break
		sleep .25
	done
	[ "$(http_code /api/queue)" = 200 ] || {
		echo 'queue did not become ready' >&2
		exit 1
	}
	# The old release must run without the booking secret attached.
	[ ! -e "$DROPIN_DIR/booking.conf" ]
	! systemctl show "$UNIT" -p EnvironmentFiles --value | grep -Fq "$ENV_FILE"
	;;
check-new)
	# Both the queue and the booking route must become ready; the booking
	# route may appear slightly after the queue starts serving.
	booking_code=000
	for _ in $(seq 1 80); do
		systemctl is-active --quiet "$UNIT" || exit 1
		if [ "$(http_code /api/queue)" = 200 ]; then
			booking_code=$(http_code /api/booking/services)
			[ "$booking_code" = 401 ] && break
		fi
		sleep .25
	done
	[ "$(http_code /api/queue)" = 200 ] || {
		echo 'queue did not become ready' >&2
		exit 1
	}
	# A healthy queue alone is insufficient: booking must reach authentication.
	[ "$booking_code" = 401 ] || {
		echo "booking route did not reach authentication (status $booking_code)" >&2
		exit 1
	}
	[ -f "$DROPIN_DIR/booking.conf" ]
	systemctl show "$UNIT" -p EnvironmentFiles --value | grep -Fq "$ENV_FILE"
	;;
*)
	echo 'unknown operation' >&2
	exit 2
	;;
esac
