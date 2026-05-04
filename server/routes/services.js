const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { emitQueueUpdate } = require('../services/emitQueueUpdate');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizeClientId(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : null;
}

router.get('/', async (req, res, next) => {
  try {
    const all = req.query.all === '1';
    const clientId = sanitizeClientId(req.query.client_id);
    let rows;
    if (clientId) {
      rows = all
        ? await db.prepare('SELECT * FROM services WHERE active = 1 AND client_id = ? ORDER BY priority DESC, name').all(clientId)
        : await db.prepare('SELECT * FROM services WHERE active = 1 AND enabled = 1 AND client_id = ? ORDER BY priority DESC, name').all(clientId);
      if (rows.length === 0) {
        rows = all
          ? await db.prepare("SELECT * FROM services WHERE active = 1 AND client_id IS NULL ORDER BY priority DESC, name").all()
          : await db.prepare("SELECT * FROM services WHERE active = 1 AND enabled = 1 AND client_id IS NULL ORDER BY priority DESC, name").all();
      }
    } else {
      rows = all
        ? await db.prepare('SELECT * FROM services WHERE active = 1 AND client_id IS NULL ORDER BY priority DESC, name').all()
        : await db.prepare('SELECT * FROM services WHERE active = 1 AND enabled = 1 AND client_id IS NULL ORDER BY priority DESC, name').all();
    }
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/my', requireAuth, async (req, res, next) => {
  try {
    const all = req.query.all === '1';
    const clientId = req.user.clientId || null;
    if (clientId) {
      const countRow = await db.prepare('SELECT COUNT(*) AS c FROM services WHERE client_id = ?').get(clientId);
      if (parseInt(countRow.c) === 0) {
        const defaults = await db.prepare("SELECT name, description, avg_duration_minutes, priority, daily_limit FROM services WHERE client_id IS NULL AND active = 1").all();
        for (const d of defaults) {
          await db.pool.query(
            'INSERT INTO services (name, description, avg_duration_minutes, priority, daily_limit, client_id) VALUES ($1,$2,$3,$4,$5,$6)',
            [d.name, d.description, d.avg_duration_minutes, d.priority, d.daily_limit, clientId]
          );
        }
      }
      const rows = all
        ? await db.prepare('SELECT * FROM services WHERE active = 1 AND client_id = ? ORDER BY priority DESC, name').all(clientId)
        : await db.prepare('SELECT * FROM services WHERE active = 1 AND enabled = 1 AND client_id = ? ORDER BY priority DESC, name').all(clientId);
      res.json(rows);
    } else {
      const rows = all
        ? await db.prepare("SELECT * FROM services WHERE active = 1 AND (client_id IS NULL OR client_id = '') ORDER BY priority DESC, name").all()
        : await db.prepare("SELECT * FROM services WHERE active = 1 AND enabled = 1 AND (client_id IS NULL OR client_id = '') ORDER BY priority DESC, name").all();
      res.json(rows);
    }
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const clientId = req.user.clientId || null;
    if (!clientId) return res.status(400).json({ error: 'Не определён клиент' });
    const { rows } = await db.pool.query(
      'INSERT INTO services (name, description, avg_duration_minutes, priority, daily_limit, client_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name.trim(), description || null, avg_duration_minutes || 5, priority || 0, daily_limit || null, clientId]
    );
    const svc = await db.prepare('SELECT * FROM services WHERE id = ?').get(rows[0].id);
    const { log } = require('../services/logging');
    await log(req, 'service.created', name.trim());
    await emitQueueUpdate();
    res.json(svc);
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    let svc;
    if (clientId) {
      svc = await db.prepare('SELECT * FROM services WHERE id = ? AND client_id = ?').get(id, clientId);
    } else {
      svc = await db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    }
    if (!svc) return res.status(404).json({ error: 'Not found' });

    const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
    await db.pool.query(
      'UPDATE services SET name=$1, description=$2, avg_duration_minutes=$3, priority=$4, daily_limit=$5 WHERE id=$6',
      [name, description || null, avg_duration_minutes, priority || 0, daily_limit || null, id]
    );
    const updated = await db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    const { log } = require('../services/logging');
    await log(req, 'service.updated', name);
    res.json(updated);
  } catch (err) { next(err); }
});

router.put('/:id/set-default', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    let svc;
    if (clientId) {
      svc = await db.prepare('SELECT * FROM services WHERE id = ? AND active = 1 AND client_id = ?').get(id, clientId);
    } else {
      svc = await db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(id);
    }
    if (!svc) return res.status(404).json({ error: 'Not found' });
    if (svc.is_default) {
      await db.pool.query('UPDATE services SET is_default = 0 WHERE id = $1', [id]);
    } else {
      if (clientId) {
        await db.pool.query('UPDATE services SET is_default = 0 WHERE client_id = $1', [clientId]);
      } else {
        await db.pool.query("UPDATE services SET is_default = 0 WHERE client_id IS NULL OR client_id = ''");
      }
      await db.pool.query('UPDATE services SET is_default = 1 WHERE id = $1', [id]);
    }
    const { log } = require('../services/logging');
    await log(req, svc.is_default ? 'service.unset_default' : 'service.set_default', svc.name);
    const updated = await db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) { next(err); }
});

router.put('/:id/toggle', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    let svc;
    if (clientId) {
      svc = await db.prepare('SELECT * FROM services WHERE id = ? AND client_id = ?').get(id, clientId);
    } else {
      svc = await db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    }
    if (!svc) return res.status(404).json({ error: 'Not found' });
    const newEnabled = svc.enabled ? 0 : 1;
    await db.pool.query('UPDATE services SET enabled = $1 WHERE id = $2', [newEnabled, id]);
    const { log } = require('../services/logging');
    await log(req, newEnabled ? 'service.enabled' : 'service.disabled', svc.name);
    res.json({ ...svc, enabled: newEnabled });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    let svc;
    if (clientId) {
      svc = await db.prepare('SELECT * FROM services WHERE id = ? AND client_id = ?').get(id, clientId);
    } else {
      svc = await db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    }
    if (!svc) return res.status(404).json({ error: 'Not found' });
    const transferTo = parseId(req.body.transfer_to);
    if (transferTo) {
      if (clientId) {
        await db.pool.query("UPDATE tickets SET service_id = $1 WHERE service_id = $2 AND status IN ('waiting','called') AND client_id = $3", [transferTo, id, clientId]);
      } else {
        await db.pool.query("UPDATE tickets SET service_id = $1 WHERE service_id = $2 AND status IN ('waiting','called')", [transferTo, id]);
      }
    }
    await db.pool.query('UPDATE services SET active = 0 WHERE id = $1', [id]);
    const { log } = require('../services/logging');
    await log(req, 'service.deleted', svc.name);
    await emitQueueUpdate();
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
