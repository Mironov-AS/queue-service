const express = require('express');
const db = require('../database');
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

// GET /api/queue — public state
router.get('/', (req, res) => {
  res.json(getPublicQueueState());
});

// GET /api/queue/full — admin full state
router.get('/full', requireAuth, (req, res) => {
  res.json(getQueueState());
});

// POST /api/queue/next — call next ticket
router.post('/next', requireAuth, (req, res) => {
  const d = today();

  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
  }
  const next = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'waiting'
    ORDER BY t.is_priority DESC, t.created_at ASC LIMIT 1
  `).get(d);
  if (next) {
    db.prepare("UPDATE tickets SET status='called', called_at=CURRENT_TIMESTAMP WHERE id=?").run(next.id);
    const updated = db.prepare(`
      SELECT t.*, s.name AS service_name
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?
    `).get(next.id);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ticket:called', updated);
    log(req, 'ticket.called', `#${next.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

// POST /api/queue/call/:id — call specific ticket
router.post('/call/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const d = today();

  const callSpecificTx = db.transaction(() => {
    const target = db.prepare(
      "SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'waiting'"
    ).get(id, d);
    if (!target) return null;

    const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
    if (current) {
      db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
    }
    db.prepare("UPDATE tickets SET status='called', called_at=CURRENT_TIMESTAMP WHERE id=?").run(target.id);
    return target;
  });

  const target = callSpecificTx();
  if (!target) return res.status(404).json({ error: 'Талон не найден в очереди' });

  const updated = db.prepare(
    "SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?"
  ).get(target.id);
  const { getIo } = require('../services/socketSetup');
  const io = getIo();
  if (io) io.emit('ticket:called', updated);
  log(req, 'ticket.called', `#${target.number}`);

  emitQueueUpdate();
  res.json(getQueueState());
});

// POST /api/queue/repeat — repeat current call
router.post('/repeat', requireAuth, (req, res) => {
  const d = today();
  const current = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'called' LIMIT 1
  `).get(d);
  if (current) {
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ticket:called', current);
    log(req, 'ticket.called.repeat', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

// POST /api/queue/return — return current ticket to queue
router.post('/return', requireAuth, (req, res) => {
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='waiting', called_at=NULL WHERE id=?").run(current.id);
    log(req, 'ticket.returned', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

// POST /api/queue/return/:id — return specific ticket
router.post('/return/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id талона' });
  const d = today();
  const ticket = db.prepare("SELECT * FROM tickets WHERE id=? AND date=?").get(id, d);
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });
  if (ticket.status === 'waiting') return res.status(400).json({ error: 'Талон уже в очереди' });
  db.prepare("UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE id=?").run(id);
  log(req, 'ticket.returned', `#${ticket.number}`);
  emitQueueUpdate();
  res.json({ success: true, ...getQueueState() });
});

// POST /api/queue/return-all — return all tickets to queue
router.post('/return-all', requireAuth, (req, res) => {
  const d = today();
  const result = db.prepare(
    "UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE date=? AND status IN ('called','served')"
  ).run(d);
  log(req, 'queue.return_all', `${result.changes} талонов возвращено в очередь`);
  emitQueueUpdate();
  res.json({ success: true, returned: result.changes, ...getQueueState() });
});

// POST /api/queue/complete — mark current ticket as served
// POST /api/queue/skip — alias for complete
// POST /api/queue/cancel-current — alias for complete
function completeTicket(req, res) {
  const reason = sanitizeReason(req.body?.reason);
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
    if (reason) db.prepare("UPDATE tickets SET skip_reason=? WHERE id=?").run(reason, current.id);
    log(req, 'ticket.served', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
}

router.post('/complete', requireAuth, completeTicket);
router.post('/skip', requireAuth, completeTicket);
router.post('/cancel-current', requireAuth, completeTicket);

// POST /api/queue/reset — reset today's queue
router.post('/reset', requireAuth, (req, res) => {
  const d = today();
  db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE date=? AND status IN ('waiting','called')").run(d);
  const lastTicket = db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=?").get(d);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_reset_last_id', ?)").run(String(lastTicket?.max_id || 0));
  log(req, 'queue.reset', d);
  emitQueueUpdate();
  res.json({ success: true });
});

module.exports = router;