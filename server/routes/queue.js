const express = require('express');
const { db, setClientSetting, getClientSetting } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { today, getQueueState, getPublicQueueState } = require('../services/queueState');
const { emitQueueUpdate } = require('../services/emitQueueUpdate');
const { log } = require('../services/logging');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseWindow(val) {
  if (val == null) return null;
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
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

// GET /api/queue — public state
router.get('/', async (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    let clientId = sanitizeClientId(req.query.client_id);
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const { getJwtSecret } = require('../config');
        const secret = await getJwtSecret();
        const payload = jwt.verify(token, secret);
        clientId = payload.clientId || clientId;
      } catch { /* ignore */ }
    }
    res.json(await getPublicQueueState(clientId));
  } catch (err) { next(err); }
});

// GET /api/queue/full — admin full state
router.get('/full', requireAuth, async (req, res, next) => {
  try {
    res.json(await getQueueState(req.user.clientId || null));
  } catch (err) { next(err); }
});

// POST /api/queue/next
router.post('/next', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });

    const windowsVal = await getClientSetting('windows_count', clientId, '1');
    const windowsCount = Math.max(1, parseInt(windowsVal, 10) || 1);
    const window = windowsCount > 1 ? parseWindow(req.body?.window) : null;
    if (windowsCount > 1 && !window) return res.status(400).json({ error: 'Укажите номер окна' });

    if (window) {
      const currentAtWindow = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ? AND window_number = ?").get(d, clientId, window);
      if (currentAtWindow) await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [currentAtWindow.id]);
    } else {
      const current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
      if (current) await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [current.id]);
    }

    const nextTicket = await db.prepare(`
      SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id
      WHERE t.date = ? AND t.status = 'waiting' AND t.client_id = ?
      ORDER BY t.is_priority DESC, t.created_at ASC LIMIT 1
    `).get(d, clientId);
    if (nextTicket) {
      await db.pool.query("UPDATE tickets SET status='called', called_at=NOW(), window_number=$1 WHERE id=$2", [window, nextTicket.id]);
      const updated = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?").get(nextTicket.id);
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.to(`admin:${clientId}`).to(`public:${clientId}`).emit('ticket:called', updated);
      await log(req, 'ticket.called', `#${nextTicket.number}${window ? ` → окно ${window}` : ''}`);
    }
    await emitQueueUpdate(clientId);
    res.json(await getQueueState(clientId));
  } catch (err) { next(err); }
});

// POST /api/queue/call/:id
router.post('/call/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const d = today();
    const clientId = req.user.clientId || null;

    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });

    const windowsVal = await getClientSetting('windows_count', clientId, '1');
    const windowsCount = Math.max(1, parseInt(windowsVal, 10) || 1);
    const window = windowsCount > 1 ? parseWindow(req.body?.window) : null;
    if (windowsCount > 1 && !window) return res.status(400).json({ error: 'Укажите номер окна' });

    await db.runTransaction(async (txDb) => {
      const target = await txDb.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'waiting' AND t.client_id = ?").get(id, d, clientId);
      if (!target) throw { status: 404, error: 'Талон не найден в очереди' };

      if (window) {
        const currentAtWindow = await txDb.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ? AND window_number = ?").get(d, clientId, window);
        if (currentAtWindow) await txDb.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE id=?").run(currentAtWindow.id);
      } else {
        const current = await txDb.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
        if (current) await txDb.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE id=?").run(current.id);
      }
      await txDb.prepare("UPDATE tickets SET status='called', called_at=NOW(), window_number=? WHERE id=?").run(window, target.id);
    });

    const updated = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?").get(id);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io && clientId) io.to(`admin:${clientId}`).to(`public:${clientId}`).emit('ticket:called', updated);
    await log(req, 'ticket.called', `#${updated.number}${window ? ` → окно ${window}` : ''}`);
    await emitQueueUpdate(clientId);
    res.json(await getQueueState(clientId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.error });
    next(err);
  }
});

// POST /api/queue/repeat
router.post('/repeat', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    const ticketId = parseId(req.body?.ticket_id);
    let current;
    if (ticketId) {
      current = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'called' AND t.client_id = ?").get(ticketId, d, clientId);
    } else {
      current = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = ? AND t.status = 'called' AND t.client_id = ? ORDER BY t.called_at DESC LIMIT 1").get(d, clientId);
    }
    if (current) {
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.to(`admin:${clientId}`).to(`public:${clientId}`).emit('ticket:called', current);
      await log(req, 'ticket.called.repeat', `#${current.number}`);
    }
    await emitQueueUpdate(clientId);
    res.json(await getQueueState(clientId));
  } catch (err) { next(err); }
});

// POST /api/queue/return
router.post('/return', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    const ticketId = parseId(req.body?.ticket_id);
    let current;
    if (ticketId) {
      current = await db.prepare("SELECT * FROM tickets WHERE id = ? AND date = ? AND status = 'called' AND client_id = ?").get(ticketId, d, clientId);
    } else {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
    }
    if (current) {
      await db.pool.query("UPDATE tickets SET status='waiting', called_at=NULL, window_number=NULL WHERE id=$1", [current.id]);
      await log(req, 'ticket.returned', `#${current.number}`);
    }
    await emitQueueUpdate(clientId);
    res.json(await getQueueState(clientId));
  } catch (err) { next(err); }
});

// POST /api/queue/return/:id
router.post('/return/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Неверный id талона' });
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    const ticket = await db.prepare("SELECT * FROM tickets WHERE id=? AND date=? AND client_id=?").get(id, d, clientId);
    if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
    if (ticket.status === 'waiting') return res.status(400).json({ error: 'Талон уже в очереди' });
    await db.pool.query("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE id=$1", [id]);
    await log(req, 'ticket.returned', `#${ticket.number}`);
    await emitQueueUpdate(clientId);
    res.json({ success: true, ...(await getQueueState(clientId)) });
  } catch (err) { next(err); }
});

// POST /api/queue/return-all
router.post('/return-all', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    const result = await db.prepare("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL, window_number=NULL WHERE date=? AND status IN ('called','served') AND client_id=?").run(d, clientId);
    await log(req, 'queue.return_all', `${result.changes} талонов возвращено в очередь`);
    await emitQueueUpdate(clientId);
    res.json({ success: true, returned: result.changes, ...(await getQueueState(clientId)) });
  } catch (err) { next(err); }
});

// POST /api/queue/complete | /skip | /cancel-current
async function completeTicket(req, res, next) {
  try {
    const reason = sanitizeReason(req.body?.reason);
    const ticketId = parseId(req.body?.ticket_id);
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    let current;
    if (ticketId) {
      current = await db.prepare("SELECT * FROM tickets WHERE id = ? AND date = ? AND status = 'called' AND client_id = ?").get(ticketId, d, clientId);
    } else {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
    }
    if (current) {
      await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [current.id]);
      if (reason) await db.pool.query("UPDATE tickets SET skip_reason=$1 WHERE id=$2", [reason, current.id]);
      await log(req, 'ticket.served', `#${current.number}`);
    }
    await emitQueueUpdate(clientId);
    res.json(await getQueueState(clientId));
  } catch (err) { next(err); }
}

router.post('/complete', requireAuth, completeTicket);
router.post('/skip', requireAuth, completeTicket);
router.post('/cancel-current', requireAuth, completeTicket);

// POST /api/queue/reset
router.post('/reset', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент. Невозможно выполнить операцию.' });
    await db.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE date=? AND status IN ('waiting','called') AND client_id=?").run(d, clientId);
    const lastTicket = await db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=? AND client_id=?").get(d, clientId);
    await setClientSetting('queue_reset_last_id', String(lastTicket?.max_id || 0), clientId);
    await log(req, 'queue.reset', d);
    await emitQueueUpdate(clientId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
