const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { today, getQueueState, getPublicQueueState } = require('../services/queueState');
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

    if (clientId) {
      const current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
      if (current) await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [current.id]);
      const next = await db.prepare(`
        SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id
        WHERE t.date = ? AND t.status = 'waiting' AND t.client_id = ?
        ORDER BY t.is_priority DESC, t.created_at ASC LIMIT 1
      `).get(d, clientId);
      if (next) {
        await db.pool.query("UPDATE tickets SET status='called', called_at=NOW() WHERE id=$1", [next.id]);
        const updated = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?").get(next.id);
        const { getIo } = require('../services/socketSetup');
        const io = getIo();
        if (io) io.emit('ticket:called', updated);
        await log(req, 'ticket.called', `#${next.number}`);
      }
    } else {
      const current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called'").get(d);
      if (current) await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [current.id]);
      const next = await db.prepare(`
        SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id
        WHERE t.date = ? AND t.status = 'waiting'
        ORDER BY t.is_priority DESC, t.created_at ASC LIMIT 1
      `).get(d);
      if (next) {
        await db.pool.query("UPDATE tickets SET status='called', called_at=NOW() WHERE id=$1", [next.id]);
        const updated = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?").get(next.id);
        const { getIo } = require('../services/socketSetup');
        const io = getIo();
        if (io) io.emit('ticket:called', updated);
        await log(req, 'ticket.called', `#${next.number}`);
      }
    }
    await emitQueueUpdate();
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

    await db.runTransaction(async (txDb) => {
      let target;
      if (clientId) {
        target = await txDb.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'waiting' AND t.client_id = ?").get(id, d, clientId);
      } else {
        target = await txDb.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'waiting'").get(id, d);
      }
      if (!target) throw { status: 404, error: 'Талон не найден в очереди' };

      if (clientId) {
        const current = await txDb.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
        if (current) await txDb.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE id=?").run(current.id);
      } else {
        const current = await txDb.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called'").get(d);
        if (current) await txDb.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE id=?").run(current.id);
      }
      await txDb.prepare("UPDATE tickets SET status='called', called_at=NOW() WHERE id=?").run(target.id);
    });

    const updated = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?").get(id);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ticket:called', updated);
    await log(req, 'ticket.called', `#${updated.number}`);
    await emitQueueUpdate();
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
    let current;
    if (clientId) {
      current = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = ? AND t.status = 'called' AND t.client_id = ? LIMIT 1").get(d, clientId);
    } else {
      current = await db.prepare("SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = ? AND t.status = 'called' LIMIT 1").get(d);
    }
    if (current) {
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.emit('ticket:called', current);
      await log(req, 'ticket.called.repeat', `#${current.number}`);
    }
    await emitQueueUpdate();
    res.json(await getQueueState(clientId));
  } catch (err) { next(err); }
});

// POST /api/queue/return
router.post('/return', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    let current;
    if (clientId) {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
    } else {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called'").get(d);
    }
    if (current) {
      await db.pool.query("UPDATE tickets SET status='waiting', called_at=NULL WHERE id=$1", [current.id]);
      await log(req, 'ticket.returned', `#${current.number}`);
    }
    await emitQueueUpdate();
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
    let ticket;
    if (clientId) {
      ticket = await db.prepare("SELECT * FROM tickets WHERE id=? AND date=? AND client_id=?").get(id, d, clientId);
    } else {
      ticket = await db.prepare("SELECT * FROM tickets WHERE id=? AND date=?").get(id, d);
    }
    if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
    if (ticket.status === 'waiting') return res.status(400).json({ error: 'Талон уже в очереди' });
    await db.pool.query("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE id=$1", [id]);
    await log(req, 'ticket.returned', `#${ticket.number}`);
    await emitQueueUpdate();
    res.json({ success: true, ...(await getQueueState(clientId)) });
  } catch (err) { next(err); }
});

// POST /api/queue/return-all
router.post('/return-all', requireAuth, async (req, res, next) => {
  try {
    const d = today();
    const clientId = req.user.clientId || null;
    let result;
    if (clientId) {
      result = await db.prepare("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE date=? AND status IN ('called','served') AND client_id=?").run(d, clientId);
    } else {
      result = await db.prepare("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE date=? AND status IN ('called','served')").run(d);
    }
    await log(req, 'queue.return_all', `${result.changes} талонов возвращено в очередь`);
    await emitQueueUpdate();
    res.json({ success: true, returned: result.changes, ...(await getQueueState(clientId)) });
  } catch (err) { next(err); }
});

// POST /api/queue/complete | /skip | /cancel-current
async function completeTicket(req, res, next) {
  try {
    const reason = sanitizeReason(req.body?.reason);
    const d = today();
    const clientId = req.user.clientId || null;
    let current;
    if (clientId) {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' AND client_id = ?").get(d, clientId);
    } else {
      current = await db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called'").get(d);
    }
    if (current) {
      await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE id=$1", [current.id]);
      if (reason) await db.pool.query("UPDATE tickets SET skip_reason=$1 WHERE id=$2", [reason, current.id]);
      await log(req, 'ticket.served', `#${current.number}`);
    }
    await emitQueueUpdate();
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
    if (clientId) {
      await db.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE date=? AND status IN ('waiting','called') AND client_id=?").run(d, clientId);
    } else {
      await db.prepare("UPDATE tickets SET status='served', served_at=NOW() WHERE date=? AND status IN ('waiting','called')").run(d);
    }
    const lastTicket = await db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=?").get(d);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('queue_reset_last_id', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(lastTicket?.max_id || 0)]);
    await log(req, 'queue.reset', d);
    await emitQueueUpdate();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
