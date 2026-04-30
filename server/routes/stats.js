const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const days = clampInt(req.query.days, 1, 365, 7);
    const clientId = req.user.clientId || null;

    let q1 = `
      SELECT
        t.date,
        COALESCE(s.name, 'Без услуги') AS service_name,
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='served' THEN 1 ELSE 0 END) AS served,
        SUM(CASE WHEN t.status IN ('waiting','called') THEN 1 ELSE 0 END) AS in_queue,
        ROUND(AVG(CASE WHEN t.served_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (t.served_at - t.created_at))/60 ELSE NULL END)::numeric,1) AS avg_wait_minutes
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.date >= (CURRENT_DATE - ($1 || ' days')::interval)::date::text
    `;
    const params1 = [days - 1];
    let idx = 1;
    if (clientId) { idx++; q1 += ` AND t.client_id = $${idx}`; params1.push(clientId); }
    q1 += ' GROUP BY t.date, t.service_id, s.name ORDER BY t.date DESC, s.name';

    let q2 = `
      SELECT date,
        COUNT(*) AS total,
        SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served,
        ROUND(AVG(CASE WHEN served_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (served_at - created_at))/60 ELSE NULL END)::numeric,1) AS avg_wait_minutes
      FROM tickets
      WHERE date >= (CURRENT_DATE - ($1 || ' days')::interval)::date::text
    `;
    const params2 = [days - 1];
    let idx2 = 1;
    if (clientId) { idx2++; q2 += ` AND client_id = $${idx2}`; params2.push(clientId); }
    q2 += ' GROUP BY date ORDER BY date DESC';

    const [r1, r2] = await Promise.all([
      db.pool.query(q1, params1),
      db.pool.query(q2, params2),
    ]);

    res.json({
      rows: r1.rows.map(r => ({ ...r, total: parseInt(r.total) || 0, served: parseInt(r.served) || 0, in_queue: parseInt(r.in_queue) || 0, avg_wait_minutes: parseFloat(r.avg_wait_minutes) || null })),
      daily: r2.rows.map(r => ({ ...r, total: parseInt(r.total) || 0, served: parseInt(r.served) || 0, avg_wait_minutes: parseFloat(r.avg_wait_minutes) || null })),
    });
  } catch (err) { next(err); }
});

router.get('/export', requireAuth, async (req, res, next) => {
  try {
    const days = clampInt(req.query.days, 1, 365, 30);
    const clientId = req.user.clientId || null;

    let q = `
      SELECT t.date, t.number, COALESCE(s.name,'Без услуги') AS service,
        t.status, t.name AS visitor_name, t.phone,
        t.created_at, t.called_at, t.served_at,
        t.skip_reason, t.cancel_reason,
        ROUND(CASE WHEN t.served_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (t.served_at - t.created_at))/60 ELSE NULL END::numeric,1) AS wait_minutes
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.date >= (CURRENT_DATE - ($1 || ' days')::interval)::date::text
    `;
    const params = [days - 1];
    let idx = 1;
    if (clientId) { idx++; q += ` AND t.client_id = $${idx}`; params.push(clientId); }
    q += ' ORDER BY t.date DESC, t.number';

    const { rows } = await db.pool.query(q, params);

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

    const bom = '﻿';
    const { today } = require('../services/queueState');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="queue_stats_${today()}.csv"`);
    res.send(bom + csvRows.join('\n'));
  } catch (err) { next(err); }
});

module.exports = router;
