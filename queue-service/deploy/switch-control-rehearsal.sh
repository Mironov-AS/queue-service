#!/usr/bin/env bash
# Systemd adapter for isolated rehearsals only. Never targets production.
set -Eeuo pipefail
: "${SWITCH_TEST_ROOT:?}" "${SWITCH_TEST_UNIT:?}" "${SWITCH_TEST_PORT:?}"
root=$(realpath "$SWITCH_TEST_ROOT")
case "$root" in /opt/queue-switch-test-* | /tmp/queue-switch-test-*) ;; *)
	echo 'unsafe root' >&2
	exit 2
	;;
esac
[[ "$SWITCH_TEST_UNIT" =~ ^queue-switch-test-[a-z0-9-]+\.service$ ]] || {
	echo 'unsafe unit' >&2
	exit 2
}
[[ "$SWITCH_TEST_PORT" =~ ^[0-9]+$ ]] && ((SWITCH_TEST_PORT >= 1024 && SWITCH_TEST_PORT <= 65535 && SWITCH_TEST_PORT != 3001)) || exit 2
[ -f "$root/.isolated-test" ] && [ ! -L "$root/.isolated-test" ] || exit 2
unit=$SWITCH_TEST_UNIT
case "${1:-}" in
validate)
	[ "$(realpath "$2")" = "$root/staged" ] && [ -s "$2/index.js" ] && [ -d "$2/node_modules" ]
	;;
snapshot)
	test ! -e "$root/snapshot.db"
	node - "$root" <<'NODE'
const r=process.argv[2], D=require(r+'/server/node_modules/better-sqlite3');
const db=new D(r+'/data/queue.db',{readonly:true,fileMustExist:true});
db.backup(r+'/snapshot.db').then(()=>{db.close();let b=new D(r+'/snapshot.db',{readonly:true,fileMustExist:true});if(b.pragma('integrity_check',{simple:true})!=='ok')throw Error('integrity check failed'); console.log('snapshot tickets',b.prepare('select count(*) n from tickets').get().n);b.close()}).catch(e=>{console.error(e);process.exit(1)});
NODE
	;;
stop)
	systemctl stop "$unit"
	[ "$(systemctl show "$unit" -p ActiveState --value)" = inactive ]
	[ "$(systemctl show "$unit" -p MainPID --value)" = 0 ]
	;;
start) systemctl start "$unit" ;;
check-old | check-new)
	for attempt in {1..60}; do
		systemctl is-active --quiet "$unit" || exit 1
		if curl --fail --silent --max-time 1 "http://127.0.0.1:$SWITCH_TEST_PORT/api/queue" >/dev/null; then exit 0; fi
		sleep .25
	done
	echo 'service did not become ready' >&2
	exit 1
	;;
*)
	echo 'unknown operation' >&2
	exit 2
	;;
esac
