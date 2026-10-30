#!/bin/bash
# Rehearse real application with systemd on a copy of the queue snapshot.
# Does not touch production service or production database.
set -Eeuo pipefail
root=/opt/queue-switch-test-booking
unit=queue-switch-test-booking.service
old=/opt/queue-service/server
new=/opt/queue-service/releases/booking-resize-20261030/server
snapshot=/opt/queue-data/backups/queue-preflight-20261030-202434.db
runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='queue_switch_test_only'" | grep -q 1 && {
	echo 'test db exists'
	exit 2
}
[ ! -e "$root" ] && [ ! -e /etc/systemd/system/$unit ] && [ ! -e "/etc/systemd/system/$unit.d" ] || exit 2
! ss -ltn | grep -q ':13085 ' || exit 2
mkdir -m 755 "$root"
cleanup() {
	systemctl stop "$unit" 2>/dev/null || true
	rm -f /etc/systemd/system/$unit
	rm -rf -- "/etc/systemd/system/$unit.d"
	systemctl daemon-reload
	runuser -u postgres -- dropdb --if-exists queue_switch_test_only
	rm -rf -- "$root"
}
trap cleanup EXIT
runuser -u postgres -- createdb -O queue_booking queue_switch_test_only
set -a
. /opt/queue-service/secrets/booking.env
set +a
BOOKING_DATABASE_URL="${BOOKING_DATABASE_URL%/*}/queue_switch_test_only"
printf 'BOOKING_ENABLED=true\nBOOKING_DATABASE_URL=%s\n' "$BOOKING_DATABASE_URL" >"$root/booking.env"
# Match the production secret permissions: systemd reads this before dropping privileges.
chown root:root "$root/booking.env"
chmod 600 "$root/booking.env"
if runuser -u queueapp -- test -r "$root/booking.env"; then
	echo 'test secret unexpectedly readable by service user' >&2
	exit 1
fi
cp "$(dirname "$0")/switch-engine.sh" "$root/engine"
cp -a "$old" "$root/server"
cp -a "$new" "$root/candidate"
# Preserve the legacy upload tree required by the production sandbox settings.
test ! -e "$root/candidate/uploads"
cp -a "$root/server/uploads" "$root/candidate/uploads"
diff -qr "$root/server/uploads" "$root/candidate/uploads"
mkdir "$root/data"
cp "$snapshot" "$root/data/queue.db"
chown -R queueapp:queueapp "$root/data"
touch "$root/.isolated-test"
cat >/etc/systemd/system/$unit <<UNIT
[Unit]
Description=Isolated real queue release rehearsal
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
Environment=PORT=13085
ExecStart=/usr/bin/node $root/server/index.js
Restart=no
UNIT
systemctl daemon-reload
cp "$(dirname "$0")/switch-control-rehearsal.sh" "$root/adapter"
export SWITCH_TEST_ROOT="$root" SWITCH_TEST_UNIT="$unit" SWITCH_TEST_PORT=13085
cat >"$root/control" <<'CONTROL'
#!/bin/bash
set -euo pipefail
root=/opt/queue-switch-test-booking
unit=queue-switch-test-booking.service
dropin=/etc/systemd/system/$unit.d
if [ "$1" = start ]; then
  if [ -d "$root/previous" ]; then
    install -d -m 755 "$dropin"
    if [ -f "$root/fail-write" ]; then rm "$root/fail-write"; echo 'injected drop-in write failure' >&2; exit 1; fi
    printf '[Service]\nEnvironmentFile=%s/booking.env\n' "$root" > "$dropin/booking.conf"
  else
    rm -f -- "$dropin/booking.conf"
    rmdir --ignore-fail-on-non-empty "$dropin" 2>/dev/null || true
  fi
  if [ -f "$root/fail-reload" ]; then rm "$root/fail-reload"; echo 'injected daemon-reload failure' >&2; exit 1; fi
  systemctl daemon-reload
fi
if [ "$1" = check-new ] && [ -f "$root/fail-new" ]; then exit 1; fi
if [ "$1" = check-old ]; then
  [ ! -e "$dropin/booking.conf" ] || exit 1
  ! systemctl show "$unit" -p EnvironmentFiles --value | grep -Fq "$root/booking.env" || exit 1
fi
if [ "$1" = check-new ]; then
  [ -f "$dropin/booking.conf" ] || exit 1
  systemctl show "$unit" -p EnvironmentFiles --value | grep -Fq "$root/booking.env" || exit 1
fi
exec bash "$root/adapter" "$@"
CONTROL
chmod 700 "$root/control"
systemctl start "$unit"
"$root/control" check-old
for injected in fail-write fail-reload fail-new; do
	touch "$root/$injected"
	if SWITCH_TEST_ROOT="$root" bash "$root/engine"; then
		echo "expected failure missing: $injected" >&2
		exit 1
	fi
	"$root/control" check-old
	[ "$(stat -c '%a:%u:%g' "$root/snapshot.db")" = 600:0:0 ] || {
		echo 'snapshot permissions are not root:root 600' >&2
		exit 1
	}
	echo "verified rollback and private snapshot after $injected"
	rm -f "$root/$injected"
	if [ "$injected" != fail-new ]; then
		rm -rf "$root/staged" "$root/failed"
		rm "$root/snapshot.db"
	fi
done
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');const a=new D(r+'/data/queue.db',{readonly:true}),b=new D(r+'/snapshot.db',{readonly:true});let x=a.prepare('select count(*) n from tickets').get().n,y=b.prepare('select count(*) n from tickets').get().n;if(x!==y)process.exit(1); console.log('rollback ticket count',x);a.close();b.close();
NODE
rm -rf "$root/staged" "$root/failed"
rm -f "$root/fail-new"
rm "$root/snapshot.db"
SWITCH_TEST_ROOT="$root" bash "$root/engine"
"$root/control" check-new
node /tmp/smoke-booking.js http://127.0.0.1:13085 "$root/data" "$root/server"
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');const a=new D(r+'/data/queue.db',{readonly:true}),b=new D(r+'/snapshot.db',{readonly:true});let x=a.prepare('select count(*) n from tickets').get().n,y=b.prepare('select count(*) n from tickets').get().n;if(x!==y)process.exit(1);console.log('new version ticket count',x);a.close();b.close();
NODE
echo 'PASS real application systemd switch and rollback, isolated snapshot'
