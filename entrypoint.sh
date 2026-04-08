#!/bin/sh
set -e

# On first run: copy existing DB snapshot into the persistent data volume
if [ ! -f "$DATA_DIR/queue.db" ]; then
    echo "[entrypoint] Data volume is empty, initializing..."
    if [ -f "/app/server/queue.db" ]; then
        cp /app/server/queue.db "$DATA_DIR/queue.db"
        # Copy WAL files if present (safe to omit — SQLite will recreate them)
        [ -f "/app/server/queue.db-shm" ] && cp /app/server/queue.db-shm "$DATA_DIR/queue.db-shm" || true
        [ -f "/app/server/queue.db-wal" ] && cp /app/server/queue.db-wal "$DATA_DIR/queue.db-wal" || true
        echo "[entrypoint] Existing database migrated to volume."
    else
        echo "[entrypoint] No snapshot found — fresh database will be created."
    fi
else
    echo "[entrypoint] Existing data found in volume, skipping migration."
fi

exec node server/index.js
