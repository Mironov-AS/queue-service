#!/bin/bash
# Monthly retention run for the queue (SQLite) and booking (PostgreSQL) data.
#
# Steps:
#   1. fresh WAL-aware SQLite snapshot (read-only backup, root:root 600);
#   2. pg_dump of the booking database (consent records are legal evidence);
#   3. anonymise identifiers older than RETENTION_DAYS (default 30);
#   4. rotate snapshots/dumps older than RETENTION_DAYS, always keeping
#      the 3 newest files of each kind.
#
# Usage: retention-run.sh [--dry-run]
#   --dry-run changes nothing on disk and deletes nothing.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/queue-service/deploy}"
DATA_DIR="${DATA_DIR:-/opt/queue-data}"
BACKUP_DIR="${RETENTION_TEST_DIR:-$DATA_DIR/backups}"
DAYS="${RETENTION_DAYS:-30}"
DRY="${1:-}"

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ] || [ "$DAYS" -gt 3650 ]; then
	echo "invalid RETENTION_DAYS: $DAYS" >&2
	exit 2
fi

echo "=== retention run $(date -u +%FT%TZ) days=$DAYS dry=$([ "$DRY" = "--dry-run" ] && echo yes || echo no)"

if [ "$DRY" = "--dry-run" ]; then
	echo "dry-run: skipping snapshot and pg_dump"
else
	SWITCH_PRODUCTION=1 SWITCH_DATA_DIR="$DATA_DIR" SWITCH_BACKUP_DIR="$BACKUP_DIR" \
		bash "$DEPLOY_DIR/prod-control.sh" snapshot
	if [ -f /opt/queue-service/secrets/booking.env ]; then
		# shellcheck disable=SC1090
		set -a; . /opt/queue-service/secrets/booking.env; set +a
	fi
	if [ -n "${BOOKING_DATABASE_URL:-}" ]; then
		ts="$(date -u +%Y%m%dT%H%M%SZ)"
		out="$BACKUP_DIR/booking-$ts.sql.gz"
		umask 077
		runuser -u postgres -- pg_dump queue_booking 2>/dev/null | gzip >"$out.tmp"
		chown root:root "$out.tmp"
		chmod 600 "$out.tmp"
		mv "$out.tmp" "$out"
		echo "booking dump: $out"
	else
		echo "BOOKING_DATABASE_URL not set: skipping booking dump" >&2
	fi
fi

export DATA_DIR SERVER_DIR="${SERVER_DIR:-/opt/queue-service/server}"
if [ -f /opt/queue-service/secrets/booking.env ]; then
	# shellcheck disable=SC1090
	set -a; . /opt/queue-service/secrets/booking.env; set +a
fi
if [ "$DRY" = "--dry-run" ]; then
	node "$DEPLOY_DIR/retention-cleanup.js" --dry-run --days="$DAYS"
else
	node "$DEPLOY_DIR/retention-cleanup.js" --apply --days="$DAYS"
fi

rotate() {
	# $1 = glob pattern description, files passed as the rest of args (newest first)
	local kind="$1"; shift
	local kept=0 f age
	for f in "$@"; do
		[ -e "$f" ] || continue
		kept=$((kept + 1))
		age=$(( ($(date +%s) - $(stat -c %Y "$f")) / 86400 ))
		if [ "$kept" -le 3 ]; then
			echo "keep $kind (newest 3): $(basename "$f")"
		elif [ "$age" -gt "$DAYS" ]; then
			if [ "$DRY" = "--dry-run" ]; then
				echo "would delete $kind ($age days old): $(basename "$f")"
			else
				echo "delete $kind ($age days old): $(basename "$f")"
				rm -f "$f"
			fi
		else
			echo "keep $kind ($age days old): $(basename "$f")"
		fi
	done
}

echo "--- rotation (backups older than $DAYS days, 3 newest always kept)"
# shellcheck disable=SC2207
sqlite_files=($(ls -1t "$BACKUP_DIR"/queue-*.db 2>/dev/null || true))
# shellcheck disable=SC2207
dump_files=($(ls -1t "$BACKUP_DIR"/booking-*.sql.gz 2>/dev/null || true))
rotate "sqlite-snapshot" "${sqlite_files[@]:-}"
rotate "booking-dump" "${dump_files[@]:-}"
echo "=== retention run done"
