#!/bin/bash
# Репетиция установки на промышленной ВМ без остановки действующей службы.
#
# Что делает скрипт:
#  1. создаёт отдельную базу PostgreSQL для репетиции (queue_booking_rehearsal);
#  2. поднимает НОВУЮ версию сервера на отдельном порту 3002 на копии
#     проверенного снимка очереди (действующая служба на 3001 не трогается);
#  3. прогоняет сквозную проверку записи (public_id, слоты, создание записи,
#     переполнение, календарь администратора, отмена);
#  4. останавливает репетицию и удаляет её базу.
#
# Скрипт ничего не меняет в /opt/queue-service/server и не перезапускает
# службу queue-service.
set -euo pipefail

REL=/opt/queue-service/releases/2026-10-30-booking/server
REH=/opt/rehearsal
PORT=3002
LOG=/tmp/rehearsal.log

cleanup() {
	if [ -f /tmp/rehearsal.pid ]; then
		kill "$(cat /tmp/rehearsal.pid)" 2>/dev/null || true
		sleep 1
		kill -9 "$(cat /tmp/rehearsal.pid)" 2>/dev/null || true
		rm -f /tmp/rehearsal.pid
	fi
	rm -rf "$REH"
	runuser -u postgres -- psql -q -c \
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='queue_booking_rehearsal'" >/dev/null 2>&1 || true
	runuser -u postgres -- dropdb --if-exists queue_booking_rehearsal >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1. База репетиции =="
cleanup
runuser -u postgres -- psql -Atqc \
	"SELECT 1 FROM pg_database WHERE datname='queue_booking_rehearsal'" | grep -q 1 ||
	runuser -u postgres -- createdb -O queue_booking queue_booking_rehearsal

echo "== 2. Копия очереди из проверенного снимка =="
rm -rf "$REH"
mkdir -p "$REH"
SNAP=$(ls -t /opt/queue-data/backups/queue-*.db | head -1)
cp "$SNAP" "$REH/queue.db"
chown -R queueapp:queueapp "$REH"

echo "== 3. Запуск новой версии на порту $PORT =="
cd "$REL"
set -a
# shellcheck disable=SC1091
. /opt/queue-service/secrets/booking.env
set +a
export BOOKING_DATABASE_URL="${BOOKING_DATABASE_URL%/*}/queue_booking_rehearsal"
export DATA_DIR="$REH" PORT="$PORT" NODE_ENV=production
nohup node index.js >"$LOG" 2>&1 &
echo $! >/tmp/rehearsal.pid
for _ in $(seq 1 30); do
	if curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
	sleep 1
done
curl -sf -m 5 "http://127.0.0.1:$PORT/health" || {
	echo "сервер репетиции не поднялся"
	tail -20 "$LOG"
	exit 1
}

echo "== 4. Сквозная проверка =="
set +e
node "$(dirname "$0")/smoke-booking.js" "http://127.0.0.1:$PORT" "$REH" "$REL"
STATUS=$?
set -e

echo "== 5. Остановка репетиции =="
cleanup

echo "== 6. Действующая служба =="
systemctl is-active queue-service
curl -sf -m 5 http://127.0.0.1:3001/health && echo
exit $STATUS
