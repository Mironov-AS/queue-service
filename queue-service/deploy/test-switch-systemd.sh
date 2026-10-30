#!/usr/bin/env bash
# Isolated systemd rehearsal. Never acts on queue-service or production data.
set -Eeuo pipefail
root=/tmp/queue-switch-test-systemd
unit=queue-switch-rehearsal.service
[ ! -e "$root" ] || {
	echo 'test path already exists' >&2
	exit 1
}
[ ! -e /etc/systemd/system/$unit ] || {
	echo 'test unit already exists' >&2
	exit 1
}
mkdir -m 700 "$root"
cleanup() {
	systemctl stop "$unit" 2>/dev/null || true
	rm -f "/etc/systemd/system/$unit"
	systemctl daemon-reload
	rm -rf -- "$root"
}
trap cleanup EXIT
cp "$(dirname "$0")/switch-engine.sh" "$root/engine"
touch "$root/.isolated-test"
mkdir "$root/server" "$root/candidate" "$root/data"
echo old >"$root/server/version"
echo new >"$root/candidate/version"
echo retained >"$root/data/queue"
cat >"$root/server/app.js" <<'NODE'
const fs=require('fs'),http=require('http');const root=__dirname;http.createServer((req,res)=>{res.end(fs.readFileSync(root+'/version','utf8').trim())}).listen(13083,'127.0.0.1');
NODE
cp "$root/server/app.js" "$root/candidate/app.js"
cat >"/etc/systemd/system/$unit" <<UNIT
[Unit]
Description=Isolated switch rehearsal
[Service]
WorkingDirectory=$root/server
ExecStart=/usr/bin/node $root/server/app.js
Restart=no
UNIT
systemctl daemon-reload
cat >"$root/control" <<'CONTROL'
#!/usr/bin/env bash
set -euo pipefail
root=/tmp/queue-switch-test-systemd
case "$1" in
validate) test -s "$2/version";;
snapshot) cp "$root/data/queue" "$root/snapshot"; cmp "$root/data/queue" "$root/snapshot";;
stop) systemctl stop queue-switch-rehearsal.service;;
start) systemctl start queue-switch-rehearsal.service;;
check-new|check-old)
 expected=${1#check-}
 for i in $(seq 1 30); do
  actual=$(curl -s --max-time 1 http://127.0.0.1:13083/ || true)
  [ "$actual" = "$expected" ] && break
  sleep .2
 done
 [ "$actual" = "$expected" ] || exit 1
 if [ "$expected" = new ] && [ -f "$root/fail-new" ]; then exit 1; fi;;
esac
CONTROL
chmod 700 "$root/control"
systemctl start "$unit"
"$root/control" check-old
touch "$root/fail-new"
if SWITCH_TEST_ROOT="$root" bash "$root/engine"; then
	echo 'expected failure missing' >&2
	exit 1
fi
"$root/control" check-old
cmp "$root/data/queue" "$root/snapshot"
[ "$(cat "$root/server/version")" = old ]
echo 'PASS actual systemd rollback and data preservation'
rm -rf "$root/staged" "$root/failed"
rm "$root/fail-new"
SWITCH_TEST_ROOT="$root" bash "$root/engine"
"$root/control" check-new
cmp "$root/data/queue" "$root/snapshot"
echo 'PASS actual systemd successful switch and data preservation'
