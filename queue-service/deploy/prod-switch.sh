#!/bin/bash
# Переключение промышственной службы очереди на новую версию.
#
#   bash prod-switch.sh              — только серверный код (внешний вид не меняется)
#   bash prod-switch.sh --with-client — серверный код + новый клиентский билет
#
# Порядок действий:
#  1. согласованный снимок базы (без остановки службы);
#  2. резервная копия текущего кода для отката;
#  3. остановка службы, обновление файлов, запуск;
#  4. проверки /health, /api/queue, /visitor, /api/booking;
#  5. при любой ошибке — автоматический откат на резервную копию кода.
#
# Простой службы во время переключения — единицы секунд. Очередь, её талоны и
# история лежат в /opt/queue-data/queue.db и при переключении не меняются.
set -uo pipefail

REL=/opt/queue-service/releases/2026-10-30-booking/server
LIVE=/opt/queue-service/server
BACKUPS=/opt/queue-data/backups
TS=$(date +%Y%m%d-%H%M%S)
WITH_CLIENT=0
[ "${1:-}" = "--with-client" ] && WITH_CLIENT=1

log() { echo "[switch $(date +%H:%M:%S)] $*"; }

REASON=""
fail_and_rollback() {
	log "ОШИБКА: $REASON — откат на предыдущую версию"
	systemctl stop queue-service 2>/dev/null
	tar -xzf "$ROLLBACK" -C /opt/queue-service
	systemctl start queue-service
	sleep 3
	if curl -sf -m 5 http://127.0.0.1:3001/health >/dev/null; then
		log "откат выполнен, служба работает"
	else
		log "ОТКАТ НЕ УДАЛСЯ — нужна ручная проверка"
	fi
	exit 1
}

mkdir -p "$BACKUPS"

log "1/5 резервная копия кода для отката"
ROLLBACK=/opt/queue-service/releases/rollback-code-$TS.tar.gz
tar -czf "$ROLLBACK" --exclude=node_modules --exclude=uploads --exclude="queue*.db" \
	-C /opt/queue-service server || {
	REASON="не удалось сохранить резервную копию кода"
	fail_and_rollback
}

log "2/5 снимок базы (согласованный, без остановки службы)"
node -e "
const Database = require('$LIVE/node_modules/better-sqlite3');
const db = new Database('/opt/queue-data/queue.db', { readonly: true });
db.backup('$BACKUPS/queue-$TS.db').then(() => { db.close(); console.log('снимок: $BACKUPS/queue-$TS.db'); }).catch(e => { console.error(e); process.exit(1); });
" || {
	REASON="не удалось создать снимок базы"
	fail_and_rollback
}

log "3/5 остановка службы и обновление файлов"
systemctl stop queue-service
cp -a "$REL/index.js" "$REL/config.js" "$REL/database.js" "$REL/package.json" "$REL/package-lock.json" "$LIVE/" || REASON="не удалось скопировать основные файлы"
fail_and_rollback
for dir in middleware routes services migration; do
	rm -rf "$LIVE/$dir" || REASON="не удалось очистить $dir"
	fail_and_rollback
	cp -a "$REL/$dir" "$LIVE/$dir" || REASON="не удалось скопировать $dir"
	fail_and_rollback
done
# Недостающие пакеты node_modules (pg и его зависимости) добавляются поверх:
# существующие модули не трогаем, чтобы не сломать запущенную службу.
cd "$REL/node_modules" || REASON="нет каталога node_modules релиза"
fail_and_rollback
for d in */ @*/*/; do
	[ -e "$LIVE/node_modules/$d" ] || cp -a "$d" "$LIVE/node_modules/$d"
done
if [ "$WITH_CLIENT" = "1" ]; then
	log "    обновляем клиентский билет"
	rm -rf "$LIVE/public" || REASON="не удалось очистить public"
	fail_and_rollback
	cp -a "$REL/public" "$LIVE/public" || REASON="не удалось скопировать клиентский билет"
	fail_and_rollback
fi
chown -R queueapp:queueapp "$LIVE" 2>/dev/null

log "4/5 запуск службы"
systemctl start queue-service
for _ in $(seq 1 30); do
	curl -sf -m 2 http://127.0.0.1:3001/health >/dev/null && break
	sleep 1
done
curl -sf -m 5 http://127.0.0.1:3001/health >/dev/null || REASON="служба не поднялась"
fail_and_rollback
curl -sf -m 5 http://127.0.0.1:3001/api/queue >/dev/null || REASON="очередь не отвечает"
fail_and_rollback
curl -sf -m 5 http://127.0.0.1:3001/visitor >/dev/null || REASON="страница посетителя не открывается"
fail_and_rollback
BOOKING=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:3001/api/booking/services)
log "    /api/booking/services → $BOOKING (401 — токен не передан, 503 — запись выключена, 200 — запись включена)"

log "5/5 проверка состояния службы"
systemctl is-active queue-service
systemctl show queue-service -p NRestarts
echo "снимок базы: $BACKUPS/queue-$TS.db"
echo "резервная копия кода: $ROLLBACK"
log "готово"
