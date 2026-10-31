#!/bin/bash
# Rehearsal of the production switch logic (prod-control.sh + switch-engine-v2.sh)
# on copies. It never touches the production unit, database or release directories.
set -Eeuo pipefail
root=/opt/queue-switch-test-prod
unit=queue-switch-test-prod.service
port=13086
live_src=/opt/queue-service/server
candidate_src=/opt/queue-service/releases/booking-resize-20261030/server
snapshot_src=/opt/queue-data/backups/queue-manual-20261030T185654Z.db
testdb=queue_switch_test_only
[ "$(id -u)" = 0 ] || {
	echo 'root required' >&2
	exit 1
}
[ -f "$snapshot_src" ] || {
	echo 'agreed snapshot missing' >&2
	exit 1
}
runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$testdb'" | grep -q 1 && {
	echo 'test db exists'
	exit 2
}
[ ! -e "$root" ] && [ ! -e "/etc/systemd/system/$unit" ] && [ ! -e "/etc/systemd/system/$unit.d" ] || exit 2
! ss -ltn | grep -q ":$port " || exit 2
mkdir -m 755 "$root"
cleanup() {
	systemctl stop "$unit" 2>/dev/null || true
	rm -f "/etc/systemd/system/$unit"
	rm -rf -- "/etc/systemd/system/$unit.d"
	systemctl daemon-reload
	runuser -u postgres -- dropdb --if-exists "$testdb"
	rm -rf -- "$root"
}
trap cleanup EXIT
runuser -u postgres -- createdb -O queue_booking "$testdb"
set -a
. /opt/queue-service/secrets/booking.env
set +a
BOOKING_DATABASE_URL="${BOOKING_DATABASE_URL%/*}/$testdb"
printf 'BOOKING_ENABLED=true\nBOOKING_DATABASE_URL=%s\n' "$BOOKING_DATABASE_URL" >"$root/booking.env"
chown root:root "$root/booking.env"
chmod 600 "$root/booking.env"
if runuser -u queueapp -- test -r "$root/booking.env"; then
	echo 'test secret unexpectedly readable by service user' >&2
	exit 1
fi
cp -a "$live_src" "$root/server"
cp -a "$candidate_src" "$root/candidate"
test ! -e "$root/candidate/uploads"
cp -a "$root/server/uploads" "$root/candidate/uploads"
mkdir -p "$root/data" "$root/backups"
cp "$snapshot_src" "$root/data/queue.db"
chown -R queueapp:queueapp "$root/data"
chmod 750 "$root/data"
cat >/etc/systemd/system/$unit <<UNIT
[Unit]
Description=Isolated rehearsal of the production switch logic
[Service]
User=queueapp
Group=queueapp
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$root/data $root/server/uploads
WorkingDirectory=$root/server
Environment=NODE_ENV=production
Environment=DATA_DIR=$root/data
Environment=PORT=$port
ExecStart=/usr/bin/node $root/server/index.js
Restart=no
UNIT
systemctl daemon-reload
export SWITCH_UNIT=$unit
export SWITCH_PORT=$port
export SWITCH_DATA_DIR=$root/data
export SWITCH_ENV_FILE=$root/booking.env
export SWITCH_DROPIN_DIR=/etc/systemd/system/$unit.d
export SWITCH_NODE_MODULES=$root/server/node_modules
export SWITCH_BACKUP_DIR=$root/backups
export SWITCH_LIVE=$root/server
export SWITCH_CANDIDATE=$root/candidate
export SWITCH_OLD=$root/previous
export SWITCH_STAGE=$root/staged
export SWITCH_WORK=$root/work
export SWITCH_PRODUCTION=0
export SWITCH_CONTROL=$root/control
cp "$(dirname "$0")/prod-control.sh" "$root/prod-control"
cp "$(dirname "$0")/switch-engine-v2.sh" "$root/engine"
cat >"$root/control" <<'CONTROL'
#!/bin/bash
set -euo pipefail
root=/opt/queue-switch-test-prod
if [ "${1:-}" = check-new ] && [ -f "$root/fail-new" ]; then
	echo 'injected new-version check failure' >&2
	exit 1
fi
exec bash "$root/prod-control" "$@"
CONTROL
chmod 700 "$root/control"
systemctl start "$unit"
bash "$root/prod-control" check-old
# 1. Injected failure after the swap: the engine must roll back and detach the secret.
touch "$root/fail-new"
if bash "$root/engine"; then
	echo 'expected failure missing: fail-new' >&2
	exit 1
fi
bash "$root/prod-control" check-old
[ ! -e "$root/previous" ] || {
	echo 'previous release was not consumed by the rollback' >&2
	exit 1
}
[ -d "$root/server" ] && [ -s "$root/server/index.js" ]
[ ! -e "/etc/systemd/system/$unit.d/booking.conf" ]
ls "$root/backups"/queue-switch-*.db >/dev/null
for f in "$root/backups"/queue-switch-*.db; do
	[ "$(stat -c '%a:%u:%g' "$f")" = 600:0:0 ] || {
		echo 'snapshot permissions are not root:root 600' >&2
		exit 1
	}
done
[ "$(stat -c '%u:%g:%a' "$root/server/uploads")" = "$(stat -c '%u:%g:%a' "$live_src/uploads")" ]
echo 'verified rollback, detached secret and private snapshot after fail-new'
rm -rf "$root/server.failed" "$root/staged" "$root/work"
rm -f "$root/fail-new"
rm -f "$root/backups"/queue-switch-*.db
# 2. Successful switch of the production logic.
# Simulate a candidate whose static files were uploaded by another user with
# restrictive modes: the switch must still leave a tree the service can read.
chown -R root:root "$root/candidate/public"
find "$root/candidate/public" -type d -exec chmod 700 {} +
find "$root/candidate/public" -type f -exec chmod 600 {} +
bash "$root/engine"
live_owner=$(stat -c '%u:%g' "$live_src")
[ "$(stat -c '%u:%g' "$root/server")" = "$live_owner" ] || {
	echo 'switched tree does not belong to the service account' >&2
	exit 1
}
[ "$(stat -c '%u:%g' "$root/server/public")" = "$live_owner" ] || {
	echo 'switched public tree does not belong to the service account' >&2
	exit 1
}
runuser -u queueapp -- test -r "$root/server/public/index.html" || {
	echo 'service user cannot read the switched public tree' >&2
	exit 1
}
echo 'verified ownership normalisation of the switched tree'
bash "$root/prod-control" check-new
grep -Fq "EnvironmentFile=$root/booking.env" "/etc/systemd/system/$unit.d/booking.conf"
systemctl show "$unit" -p EnvironmentFiles --value | grep -Fq "$root/booking.env"
node "$(dirname "$0")/smoke-booking.js" "http://127.0.0.1:$port" "$root/data" "$root/server"
[ "$(stat -c '%u:%g:%a' "$root/server/uploads")" = "$(stat -c '%u:%g:%a' "$live_src/uploads")" ]
diff -qr "$root/server/uploads" "$live_src/uploads"
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');
const a=new D(r+'/data/queue.db',{readonly:true});
const n=a.prepare('select count(*) n from tickets').get().n;
a.close();
if(n<=0)process.exit(1);
console.log('queue tickets after switch',n);
NODE
echo 'PASS production switch logic rehearsed on copies'
