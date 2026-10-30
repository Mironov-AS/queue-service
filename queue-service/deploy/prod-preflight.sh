#!/usr/bin/env bash
# Read-only production preflight; intentionally cannot switch or restart anything.
set -euo pipefail
live=/opt/queue-service/server
candidate=/opt/queue-service/releases/booking-resize-20261030/server
config_file=/opt/queue-service/secrets/booking.env
unit=queue-service.service
[ "$(id -u)" = 0 ] || {
	echo 'root required' >&2
	exit 1
}
[ -d "$live" ] && [ ! -L "$live" ] && [ -d "$candidate" ] && [ ! -L "$candidate" ]
[ -f "$config_file" ] && [ ! -L "$config_file" ] && [ "$(stat -c '%u:%g:%a' "$config_file")" = 0:0:600 ]
[ -s "$candidate/index.js" ] && [ -d "$candidate/node_modules" ] && [ -s "$candidate/database.js" ]
cmp -s "$live/database.js" "$candidate/database.js" || {
	echo 'SQLite initialization mismatch' >&2
	exit 1
}
[ -d "$live/uploads" ] && [ ! -L "$live/uploads" ]
unexpected=$(find "$live/uploads" ! -type d ! -type f -print -quit)
[ -z "$unexpected" ] || {
	echo 'unsafe upload entry' >&2
	exit 1
}
systemctl is-active --quiet "$unit"
[ "$(systemctl show "$unit" -p WorkingDirectory --value)" = "$live" ]
[ "$(systemctl show "$unit" -p User --value)" = queueapp ]
[ "$(systemctl show "$unit" -p MainPID --value)" -gt 0 ]
curl --fail --silent --max-time 5 http://127.0.0.1:3001/api/queue >/dev/null
# Do not echo the connection string. Check target and PostgreSQL permissions.
set -a
. "$config_file"
set +a
node - "$candidate" <<'NODE'
const {Pool}=require(process.argv[2]+'/node_modules/pg');
if(process.env.BOOKING_ENABLED !== 'true') throw Error('booking is not explicitly enabled');
const u=new URL(process.env.BOOKING_DATABASE_URL || '');
if(!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname)||u.pathname!='/queue_booking') throw Error('unexpected booking database target');
const pool=new Pool({connectionString:process.env.BOOKING_DATABASE_URL,connectionTimeoutMillis:5000});
(async()=>{const {rows:[r]}=await pool.query("select current_database() db, has_database_privilege(current_user,current_database(),'CONNECT') can_connect, has_schema_privilege(current_user,'public','CREATE') can_create, pg_is_in_recovery() replica");if(r.db!=='queue_booking'||!r.can_connect||!r.can_create||r.replica)throw Error('booking database not ready');await pool.end(); console.log('booking database connection and permissions verified')})().catch(async e=>{console.error(e.message);await pool.end();process.exitCode=1});
NODE
printf '%s\n' 'Read-only preflight passed; no release switch performed. Snapshot and rollback checks remain required.'
