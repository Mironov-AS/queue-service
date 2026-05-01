const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { db, getClientSetting } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { getJwtSecret } = require('../config');
const { today, getQueueState, nextTicketNumber } = require('../services/queueState');
const { emitQueueUpdate } = require('../services/emitQueueUpdate');
const { log } = require('../services/logging');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizeReason(val) {
  if (!val || typeof val !== 'string') return null;
  return val.trim().slice(0, 500) || null;
}

function sanitizeClientId(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : null;
}

const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' }
});

router.post('/', ticketLimiter, async (req, res, next) => {
  try {
    const { service_id, name, phone, field_values } = req.body;
    const d = today();

    let effectiveUser = req.user || null;
    if (!effectiveUser && req.query.auth_token) {
      try {
        const secret = await getJwtSecret();
        const payload = jwt.verify(req.query.auth_token, secret);
        effectiveUser = {
          id: payload.userId || payload.id,
          username: payload.email || payload.username,
          role: payload.role,
          clientId: payload.clientId || null,
        };
      } catch {}
    }
    const visitorClientId = sanitizeClientId(req.body.client_id || req.query.client_id);

    if (name && (typeof name !== 'string' || name.length > 100)) {
      return res.status(400).json({ error: 'Некорректное имя' });
    }
    if (phone && (typeof phone !== 'string' || phone.length > 30)) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const regVal = await getClientSetting('registration_open', effectiveUser?.clientId || visitorClientId, '1');
    if (regVal !== '1') {
      return res.status(403).json({ error: 'Самостоятельная запись временно недоступна' });
    }

    if (service_id) {
      const clientId = effectiveUser?.clientId || visitorClientId;
      let svc;
      if (clientId) {
        svc = await db.pool.query(
          'SELECT * FROM services WHERE id = $1 AND active = 1 AND enabled = 1 AND (client_id = $2 OR client_id IS NULL)',
          [service_id, clientId]
        ).then(r => r.rows[0]);
      } else {
        svc = await db.pool.query(
          'SELECT * FROM services WHERE id = $1 AND active = 1 AND enabled = 1 AND client_id IS NULL',
          [service_id]
        ).then(r => r.rows[0]);
      }
      if (!svc) return res.status(400).json({ error: 'Услуга недоступна' });
      if (svc.daily_limit) {
        const todayCount = await db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE date = ? AND service_id = ?").get(d, service_id);
        if (parseInt(todayCount.c) >= svc.daily_limit) {
          return res.status(400).json({ error: 'Достигнут дневной лимит талонов для этой услуги' });
        }
      }
    }

    const clientId = effectiveUser?.clientId || visitorClientId;
    const number = await nextTicketNumber(d, clientId);
    const fvJson = field_values ? JSON.stringify(field_values) : null;

    const { rows } = await db.pool.query(
      'INSERT INTO tickets (number, date, service_id, name, phone, field_values, status, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [number, d, service_id || null, name || null, phone || null, fvJson, 'waiting', clientId]
    );
    const ticketId = rows[0].id;

    const ticket = await db.prepare(`
      SELECT t.*, s.name AS service_name, s.avg_duration_minutes
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.id = ?
    `).get(ticketId);

    await emitQueueUpdate(clientId);
    const queue = await getQueueState(clientId);
    const position = queue.waiting.findIndex(t => t.id === ticket.id) + 1;

    res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position });
  } catch (err) { next(err); }
});

router.post('/manual', requireAuth, async (req, res, next) => {
  try {
    const { service_id, name, phone, is_priority, field_values } = req.body;
    const d = today();

    if (name && (typeof name !== 'string' || name.length > 100)) {
      return res.status(400).json({ error: 'Некорректное имя' });
    }
    if (phone && (typeof phone !== 'string' || phone.length > 30)) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно создать талон.' });
    const number = await nextTicketNumber(d, clientId);
    const fvJson = field_values?.length ? JSON.stringify(field_values) : null;

    const { rows } = await db.pool.query(
      'INSERT INTO tickets (number, date, service_id, name, phone, is_priority, field_values, status, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [number, d, service_id || null, name || null, phone || null, is_priority ? 1 : 0, fvJson, 'waiting', clientId]
    );
    const ticketId = rows[0].id;

    const ticket = await db.prepare(`
      SELECT t.*, s.name AS service_name
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?
    `).get(ticketId);

    await log(req, 'ticket.manual', `#${number} ${name || ''} ${phone || ''}`);
    await emitQueueUpdate(clientId);
    res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [] });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });

    const clientId = req.user?.clientId || sanitizeClientId(req.query.client_id);
    let ticket;
    if (clientId) {
      ticket = await db.prepare(`
        SELECT t.id, t.number, t.date, t.status, t.service_id, t.is_priority,
               t.created_at, t.called_at, t.served_at, t.field_values, t.client_id,
               s.name AS service_name, s.avg_duration_minutes
        FROM tickets t LEFT JOIN services s ON t.service_id = s.id
        WHERE t.id = ? AND t.client_id = ?
      `).get(id, clientId);
    } else {
      ticket = await db.prepare(`
        SELECT t.id, t.number, t.date, t.status, t.service_id, t.is_priority,
               t.created_at, t.called_at, t.served_at, t.field_values, t.client_id,
               s.name AS service_name, s.avg_duration_minutes
        FROM tickets t LEFT JOIN services s ON t.service_id = s.id
        WHERE t.id = ?
      `).get(id);
    }

    if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

    let position = 0, estimatedWait = null;
    if (ticket.status === 'waiting') {
      const effectiveClientId = clientId || ticket.client_id;
      const queue = await getQueueState(effectiveClientId);
      const idx = queue.waiting.findIndex(t => t.id === ticket.id);
      position = idx >= 0 ? idx + 1 : 0;
      estimatedWait = ticket.avg_duration_minutes > 0 ? position * ticket.avg_duration_minutes : null;
    }

    res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position, estimatedWait });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент' });
    const ticket = await db.prepare("SELECT * FROM tickets WHERE id = ? AND client_id = ?").get(id, clientId);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    if (!['waiting', 'called'].includes(ticket.status)) {
      return res.status(400).json({ error: 'Талон уже не активен' });
    }
    await db.pool.query("UPDATE tickets SET status = 'served', served_at = NOW() WHERE id = $1", [id]);
    await emitQueueUpdate(clientId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });

    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент' });
    const ticket = await db.prepare("SELECT * FROM tickets WHERE id = ? AND client_id = ?").get(id, clientId);
    if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

    const { name, phone, service_id, is_priority, field_values, status, window_number } = req.body;

    if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 100)) {
      return res.status(400).json({ error: 'Некорректное имя' });
    }
    if (phone !== undefined && phone !== null && (typeof phone !== 'string' || phone.length > 30)) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const VALID_STATUSES = ['waiting', 'called', 'served'];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус' });
    }

    const svcId = service_id !== undefined ? (parseId(service_id) || null) : ticket.service_id;
    const newName = name !== undefined ? (typeof name === 'string' ? name.trim() || null : null) : ticket.name;
    const newPhone = phone !== undefined ? (typeof phone === 'string' ? phone.trim() || null : null) : ticket.phone;
    const newIsPriority = is_priority !== undefined ? (is_priority ? 1 : 0) : ticket.is_priority;
    const newFieldValues = field_values !== undefined
      ? (Array.isArray(field_values) && field_values.length ? JSON.stringify(field_values) : null)
      : ticket.field_values;
    const newStatus = status !== undefined ? status : ticket.status;
    const newWindow = window_number !== undefined
      ? (window_number === null ? null : Math.max(1, Math.min(20, parseInt(window_number, 10) || 1)))
      : ticket.window_number;

    await db.pool.query(`
      UPDATE tickets SET name=$1, phone=$2, service_id=$3, is_priority=$4, field_values=$5, status=$6, window_number=$7
      WHERE id=$8
    `, [newName, newPhone, svcId, newIsPriority, newFieldValues, newStatus, newWindow, id]);

    const updated = await db.prepare(`
      SELECT t.*, s.name AS service_name
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?
    `).get(id);

    await log(req, 'ticket.edited', `#${ticket.number}`);
    await emitQueueUpdate(clientId);
    res.json({ ...updated, field_values: updated.field_values ? JSON.parse(updated.field_values) : [] });
  } catch (err) { next(err); }
});

router.put('/:id/transfer', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const { service_id } = req.body;
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент' });
    const ticket = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.client_id = ?").get(id, clientId);
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    const svcId = parseId(service_id);
    if (!svcId) return res.status(400).json({ error: 'Некорректный service_id' });
    await db.pool.query('UPDATE tickets SET service_id = $1 WHERE id = $2', [svcId, id]);
    const newSvc = await db.prepare('SELECT name FROM services WHERE id = ?').get(svcId);
    await log(req, 'ticket.transferred', `#${ticket.number}: ${ticket.service_name} → ${newSvc?.name}`);
    await emitQueueUpdate(clientId);
    const result = await db.prepare('SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?').get(id);
    res.json(result);
  } catch (err) { next(err); }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rawDate = req.query.date;
    const d = rawDate && DATE_RE.test(rawDate) ? rawDate : today();
    const VALID_STATUSES = ['waiting', 'called', 'served'];
    const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : null;
    const service_id = parseId(req.query.service_id) || null;

    const clientId = req.user.clientId || null;
    let q = 'SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = $1';
    const params = [d];
    let idx = 1;
    if (clientId) { idx++; q += ` AND t.client_id = $${idx}`; params.push(clientId); }
    else { q += ' AND t.client_id IS NULL'; }
    if (status) { idx++; q += ` AND t.status = $${idx}`; params.push(status); }
    if (service_id) { idx++; q += ` AND t.service_id = $${idx}`; params.push(service_id); }
    q += ' ORDER BY t.created_at DESC';

    const { rows } = await db.pool.query(q, params);
    res.json(rows.map(t => ({
      ...t,
      field_values: t.field_values ? JSON.parse(t.field_values) : []
    })));
  } catch (err) { next(err); }
});

module.exports = router;
