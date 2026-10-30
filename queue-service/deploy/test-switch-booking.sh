#!/bin/bash
# Rehearse real application with systemd on a copy of the queue snapshot.
# Does not touch production service or production database.
set -Eeuo pipefail
root=/tmp/queue-switch-test-booking
unit=queue-switch-booking.service
old=/opt/queue-service/server
new=/opt/queue-service/releases/booking-final-preflight-20261030/server
snapshot=/opt/queue-data/backups/queue-preflight-20261030-202434.db
runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='queue_switch_test_only'" | grep -q 1 && {
	echo 'test db exists'
	exit 2
}
[ ! -e "$root" ] && [ ! -e /etc/systemd/system/$unit ] || exit 2
! ss -ltn | grep -q ':13085 ' || exit 2
mkdir -m 700 "$root"
cleanup() {
	systemctl stop "$unit" 2>/dev/null || true
	rm -f /etc/systemd/system/$unit
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
chmod 600 "$root/booking.env"
cp "$(dirname "$0")/switch-engine.sh" "$root/engine"
cp -a "$old" "$root/server"
cp -a "$new" "$root/candidate"
mkdir "$root/data"
cp "$snapshot" "$root/data/queue.db"
touch "$root/.isolated-test"
cat >/etc/systemd/system/$unit <<UNIT
[Unit]
Description=Isolated real queue release rehearsal
[Service]
WorkingDirectory=$root/server
Environment=NODE_ENV=production
Environment=DATA_DIR=$root/data
Environment=PORT=13085
EnvironmentFile=$root/booking.env
ExecStart=/usr/bin/node $root/server/index.js
Restart=no
UNIT
systemctl daemon-reload
cat >"$root/control" <<'CONTROL'
#!/bin/bash
set -euo pipefail
root=/tmp/queue-switch-test-booking
case "$1" in
validate) test -s "$2/index.js" && test -d "$2/node_modules";;
snapshot) node - "$root" <<'NODE'
const root=process.argv[2],Database=require(root+'/server/node_modules/better-sqlite3');let db=new Database(root+'/data/queue.db',{readonly:true});db.backup(root+'/snapshot.db').then(()=>db.close()).catch(e=>{console.error(e);process.exit(1)});
NODE
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');const db=new D(r+'/snapshot.db',{readonly:true});if(db.pragma('integrity_check',{simple:true})!=='ok')process.exit(1);console.log('snapshot tickets',db.prepare('select count(*) n from tickets').get().n);db.close()
NODE
;;
stop) systemctl stop queue-switch-booking.service;;
start) systemctl start queue-switch-booking.service;;
check-old|check-new)
 for i in $(seq 1 60); do curl -sf --max-time 1 http://127.0.0.1:13085/api/queue >/dev/null && break; sleep .25; done
 curl -sf --max-time 3 http://127.0.0.1:13085/api/queue >/dev/null
 if [ "$1" = check-new ] && [ -f "$root/fail-new" ]; then exit 1; fi;;
esac
CONTROL
chmod 700 "$root/control"
systemctl start "$unit"
"$root/control" check-old
touch "$root/fail-new"
if SWITCH_TEST_ROOT="$root" bash "$root/engine"; then
	echo 'expected failure missing'
	exit 1
fi
"$root/control" check-old
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');const a=new D(r+'/data/queue.db',{readonly:true}),b=new D(r+'/snapshot.db',{readonly:true});let x=a.prepare('select count(*) n from tickets').get().n,y=b.prepare('select count(*) n from tickets').get().n;if(x!==y)process.exit(1); console.log('rollback ticket count',x);a.close();b.close();
NODE
rm -rf "$root/staged" "$root/failed"
rm "$root/fail-new"
SWITCH_TEST_ROOT="$root" bash "$root/engine"
"$root/control" check-new
node /tmp/smoke-booking.js http://127.0.0.1:13085 "$root/data" "$root/server"
node - "$root" <<'NODE'
const r=process.argv[2],D=require(r+'/server/node_modules/better-sqlite3');const a=new D(r+'/data/queue.db',{readonly:true}),b=new D(r+'/snapshot.db',{readonly:true});let x=a.prepare('select count(*) n from tickets').get().n,y=b.prepare('select count(*) n from tickets').get().n;if(x!==y)process.exit(1);console.log('new version ticket count',x);a.close();b.close();
NODE
echo 'PASS real application systemd switch and rollback, isolated snapshot'
