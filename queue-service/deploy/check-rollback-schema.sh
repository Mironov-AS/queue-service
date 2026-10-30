#!/usr/bin/env bash
# Read-only guard: candidate must use exactly the same SQLite initialization
# code as the version to which we intend to roll back. This is necessary, not
# sufficient, for rollback compatibility; it cannot prove other code never
# modifies the database schema or data.
set -euo pipefail
[ "$#" -eq 2 ] || {
	echo 'usage: check-rollback-schema.sh OLD_SERVER CANDIDATE_SERVER' >&2
	exit 2
}
old=$1/database.js
new=$2/database.js
[ -f "$old" ] && [ ! -L "$old" ] && [ -f "$new" ] && [ ! -L "$new" ] || {
	echo 'database initialization file missing or symlinked' >&2
	exit 1
}
cmp -s -- "$old" "$new" || {
	echo 'database initialization differs: rollback requires further review' >&2
	exit 1
}
echo 'SQLite initialization files identical; other schema/data writes still require review'
