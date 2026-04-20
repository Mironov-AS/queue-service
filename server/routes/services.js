const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { emitQueueUpdate } = require('../services/emitQueueUpdate');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', (req, res) => {
  const all = req.query.all === '1';
  const rows = all
    ? db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY priority DESC, name').all()
    : db.prepare('SELECT * FROM services WHERE active = 1 AND enabled = 1 ORDER BY priority DESC, name').all();
  res.json(rows);
});

router.post('/', requireAuth, (req, res) => {
  const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
  const r = db.prepare(
    'INSERT INTO services (name, description, avg_duration_minutes, priority, daily_limit) VALUES (?,?,?,?,?)'
  ).run(name.trim(), description || null, avg_duration_minutes || 5, priority || 0, daily_limit || null);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(r.lastInsertRowid);
  const { log } = require('../services/logging');
  log(req, 'service.created', name.trim());
  emitQueueUpdate();
  res.json(svc);
});

router.put('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
  db.prepare(
    'UPDATE services SET name=?, description=?, avg_duration_minutes=?, priority=?, daily_limit=? WHERE id=?'
  ).run(name, description || null, avg_duration_minutes, priority || 0, daily_limit || null, id);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  const { log } = require('../services/logging');
  log(req, 'service.updated', name);
  res.json(svc);
});

router.put('/:id/set-default', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  if (svc.is_default) {
    db.prepare('UPDATE services SET is_default = 0 WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE services SET is_default = 0').run();
    db.prepare('UPDATE services SET is_default = 1 WHERE id = ?').run(id);
  }
  const { log } = require('../services/logging');
  log(req, svc.is_default ? 'service.unset_default' : 'service.set_default', svc.name);
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
});

router.put('/:id/toggle', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const newEnabled = svc.enabled ? 0 : 1;
  db.prepare('UPDATE services SET enabled = ? WHERE id = ?').run(newEnabled, id);
  const { log } = require('../services/logging');
  log(req, newEnabled ? 'service.enabled' : 'service.disabled', svc.name);
  res.json({ ...svc, enabled: newEnabled });
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const transferTo = parseId(req.body.transfer_to);
  if (transferTo) {
    db.prepare("UPDATE tickets SET service_id = ? WHERE service_id = ? AND status IN ('waiting','called')")
      .run(transferTo, id);
  }
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
  const { log } = require('../services/logging');
  log(req, 'service.deleted', svc.name);
  emitQueueUpdate();
  res.json({ success: true });
});

module.exports = router;