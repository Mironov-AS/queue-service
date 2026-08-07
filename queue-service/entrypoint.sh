#!/bin/sh
set -e

# ── First-run: seed data volume from bundled snapshot ─────────────────────────
if [ ! -f "$DATA_DIR/queue.db" ]; then
    echo "[entrypoint] Data volume is empty, initializing..."
    if [ -f "/app/server/queue.db" ]; then
        cp /app/server/queue.db "$DATA_DIR/queue.db"
        [ -f "/app/server/queue.db-shm" ] && cp /app/server/queue.db-shm "$DATA_DIR/queue.db-shm" || true
        [ -f "/app/server/queue.db-wal" ] && cp /app/server/queue.db-wal "$DATA_DIR/queue.db-wal" || true
        echo "[entrypoint] Snapshot seeded into volume."
    else
        echo "[entrypoint] No snapshot — fresh database will be created by app."
    fi
else
    # ── Pre-migration backup (rotate last 3) ──────────────────────────────────
    echo "[entrypoint] Existing database found — creating backup before start..."
    [ -f "$DATA_DIR/queue.db.bak.2" ] && mv "$DATA_DIR/queue.db.bak.2" "$DATA_DIR/queue.db.bak.3" || true
    [ -f "$DATA_DIR/queue.db.bak.1" ] && mv "$DATA_DIR/queue.db.bak.1" "$DATA_DIR/queue.db.bak.2" || true
    cp "$DATA_DIR/queue.db" "$DATA_DIR/queue.db.bak.1"
    echo "[entrypoint] Backup saved: queue.db.bak.1 (rotating, max 3 kept)"
fi

# ── Start server (migrations run automatically inside app) ────────────────────
exec node server/index.js
