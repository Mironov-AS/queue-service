const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
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

const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' }
});

router.post('/', ticketLimiter, (req, res) => {
  const { service_id, name, phone, field_values } = req.body;
  const d = today();

  if (name && (typeof name !== 'string' || name.length > 100)) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  if (phone && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Некорректный телефон' });
  }

  const regRow = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
  if (regRow?.value !== '1') {
    return res.status(403).json({ error: 'Самостоятельная запись временно недоступна' });
  }

  if (service_id) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1 AND enabled = 1').get(service_id);
    if (!svc) return res.status(400).json({ error: 'Услуга недоступна' });
    if (svc.daily_limit) {
      const todayCount = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE date = ? AND service_id = ?").get(d, service_id);
      if (todayCount.c >= svc.daily_limit) {
        return res.status(400).json({ error: 'Достигнут дневной лимит талонов для этой услуги' });
      }
    }
  }

  const number = nextTicketNumber(d);
  const fvJson = field_values ? JSON.stringify(field_values) : null;

  const r = db.prepare(
    'INSERT INTO tickets (number, date, service_id, name, phone, field_values, status) VALUES (?,?,?,?,?,?,?)'
  ).run(number, d, service_id || null, name || null, phone || null, fvJson, 'waiting');

  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(r.lastInsertRowid);

  emitQueueUpdate();

  const queue = getQueueState();
  const position = queue.waiting.findIndex(t => t.id === ticket.id) + 1;

  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position });
});

// Manual registration (admin only)
router.post('/manual', requireAuth, (req, res) => {
  const { service_id, name, phone, is_priority, field_values } = req.body;
  const d = today();

  if (name && (typeof name !== 'string' || name.length > 100)) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  if (phone && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Некорректный телефон' });
  }

  const number = nextTicketNumber(d);
  const fvJson = field_values?.length ? JSON.stringify(field_values) : null;

  const r = db.prepare(
    'INSERT INTO tickets (number, date, service_id, name, phone, is_priority, field_values, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run(number, d, service_id || null, name || null, phone || null, is_priority ? 1 : 0, fvJson, 'waiting');

  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(r.lastInsertRowid);

  log(req, 'ticket.manual', `#${number} ${name || ''} ${phone || ''}`);
  emitQueueUpdate();
  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [] });
});

router.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ticket = db.prepare(`
    SELECT t.id, t.number, t.date, t.status, t.service_id, t.is_priority,
           t.created_at, t.called_at, t.served_at, t.field_values,
           s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  let position = 0, estimatedWait = null;
  if (ticket.status === 'waiting') {
    const queue = getQueueState();
    const idx = queue.waiting.findIndex(t => t.id === ticket.id);
    position = idx >= 0 ? idx + 1 : 0;
    estimatedWait = ticket.avg_duration_minutes > 0 ? position * ticket.avg_duration_minutes : null;
  }

  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position, estimatedWait });
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const reason = sanitizeReason(req.body?.reason);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (!['waiting', 'called'].includes(ticket.status)) {
    return res.status(400).json({ error: 'Талон уже не активен' });
  }
  db.prepare(
    "UPDATE tickets SET status = 'served', served_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(id);
  emitQueueUpdate();
  res.json({ success: true });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  const { name, phone, service_id, is_priority, field_values, status } = req.body;

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

  db.prepare(`
    UPDATE tickets SET
      name=?, phone=?, service_id=?, is_priority=?, field_values=?, status=?
    WHERE id=?
  `).run(newName, newPhone, svcId, newIsPriority, newFieldValues, newStatus, id);

  const updated = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);

  log(req, 'ticket.edited', `#${ticket.number}`);
  emitQueueUpdate();
  res.json({ ...updated, field_values: updated.field_values ? JSON.parse(updated.field_values) : [] });
});

router.put('/:id/transfer', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { service_id } = req.body;
  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const svcId = parseId(service_id);
  if (!svcId) return res.status(400).json({ error: 'Некорректный service_id' });
  db.prepare('UPDATE tickets SET service_id = ? WHERE id = ?').run(svcId, id);
  const newSvc = db.prepare('SELECT name FROM services WHERE id = ?').get(svcId);
  log(req, 'ticket.transferred', `#${ticket.number}: ${ticket.service_name} → ${newSvc?.name}`);
  emitQueueUpdate();
  res.json(db.prepare('SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?').get(id));
});

// All today's tickets (admin view)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', requireAuth, (req, res) => {
  const rawDate = req.query.date;
  const d = rawDate && DATE_RE.test(rawDate) ? rawDate : today();
  const VALID_STATUSES = ['waiting', 'called', 'served'];
  const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : null;
  const service_id = parseId(req.query.service_id) || null;

  let q = `SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = ?`;
  const params = [d];
  if (status) { q += ' AND t.status = ?'; params.push(status); }
  if (service_id) { q += ' AND t.service_id = ?'; params.push(service_id); }
  q += ' ORDER BY t.created_at DESC';

  const rows = db.prepare(q).all(...params).map(t => ({
    ...t,
    field_values: t.field_values ? JSON.parse(t.field_values) : []
  }));
  res.json(rows);
});

module.exports = router;