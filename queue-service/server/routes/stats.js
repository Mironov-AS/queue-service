const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

router.get('/', requireAuth, (req, res) => {
  const days = clampInt(req.query.days, 1, 365, 7);
  const rows = db.prepare(`
    SELECT
      t.date,
      COALESCE(s.name, 'Без услуги') AS service_name,
      COUNT(*) AS total,
      SUM(CASE WHEN t.status='served' THEN 1 ELSE 0 END) AS served,
      SUM(CASE WHEN t.status IN ('waiting','called') THEN 1 ELSE 0 END) AS in_queue,
      ROUND(AVG(CASE WHEN t.served_at IS NOT NULL
        THEN (julianday(t.served_at)-julianday(t.created_at))*1440 ELSE NULL END),1) AS avg_wait_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date >= date('now', '-' || ? || ' days')
    GROUP BY t.date, t.service_id ORDER BY t.date DESC, s.name
  `).all(days - 1);

  const daily = db.prepare(`
    SELECT date,
      COUNT(*) AS total,
      SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served,
      ROUND(AVG(CASE WHEN served_at IS NOT NULL
        THEN (julianday(served_at)-julianday(created_at))*1440 ELSE NULL END),1) AS avg_wait_minutes
    FROM tickets
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date ORDER BY date DESC
  `).all(days - 1);

  res.json({ rows, daily });
});

router.get('/export', requireAuth, (req, res) => {
  const days = clampInt(req.query.days, 1, 365, 30);
  const rows = db.prepare(`
    SELECT t.date, t.number, COALESCE(s.name,'Без услуги') AS service,
      t.status, t.name AS visitor_name, t.phone,
      t.created_at, t.called_at, t.served_at,
      t.skip_reason, t.cancel_reason,
      ROUND(CASE WHEN t.served_at IS NOT NULL
        THEN (julianday(t.served_at)-julianday(t.created_at))*1440 ELSE NULL END,1) AS wait_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date >= date('now', '-' || ? || ' days')
    ORDER BY t.date DESC, t.number
  `).all(days - 1);

  const headers = ['Дата','Номер','Услуга','Статус','Имя','Телефон','Получен','Вызван','Обслужен','Причина пропуска','Причина отмены','Ожидание (мин)'];
  const csvRows = [headers.join(';')];
  for (const r of rows) {
    const safeCsv = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    csvRows.push([
      r.date, r.number, r.service, r.status, r.visitor_name||'', r.phone||'',
      r.created_at||'', r.called_at||'', r.served_at||'',
      r.skip_reason||'', r.cancel_reason||'', r.wait_minutes||''
    ].map(safeCsv).join(';'));
  }

  const bom = '\uFEFF';
  const { today } = require('../services/queueState');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="queue_stats_${today()}.csv"`);
  res.send(bom + csvRows.join('\n'));
});

module.exports = router;