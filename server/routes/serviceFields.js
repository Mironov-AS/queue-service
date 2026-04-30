const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const VALID_FIELD_TYPES = ['text', 'phone', 'number', 'date', 'email', 'textarea'];

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/:id/fields', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const fields = await db.prepare(
      'SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC'
    ).all(id);
    res.json(fields);
  } catch (err) { next(err); }
});

router.post('/:id/fields', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const clientId = req.user.clientId || null;
    if (clientId) {
      const svc = await db.prepare('SELECT id FROM services WHERE id = ? AND client_id = ?').get(id, clientId);
      if (!svc) return res.status(404).json({ error: 'Услуга не найдена' });
    }
    const { label, field_type, required } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Название поля обязательно' });
    const ft = field_type && VALID_FIELD_TYPES.includes(field_type) ? field_type : 'text';
    const maxOrder = await db.prepare(
      'SELECT COALESCE(MAX(order_index), -1) AS m FROM service_fields WHERE service_id = ?'
    ).get(id);
    const { rows } = await db.pool.query(
      'INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [id, label.trim(), ft, required ? 1 : 0, parseInt(maxOrder.m) + 1]
    );
    const field = await db.prepare('SELECT * FROM service_fields WHERE id = ?').get(rows[0].id);
    res.json(field);
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const { label, field_type, required, order_index } = req.body;
    const field = await db.prepare('SELECT * FROM service_fields WHERE id = ?').get(id);
    if (!field) return res.status(404).json({ error: 'Not found' });
    const clientId = req.user.clientId || null;
    if (clientId) {
      const svc = await db.prepare('SELECT id FROM services WHERE id = ? AND client_id = ?').get(field.service_id, clientId);
      if (!svc) return res.status(403).json({ error: 'Нет доступа' });
    }
    const ft = field_type
      ? (VALID_FIELD_TYPES.includes(field_type) ? field_type : field.field_type)
      : field.field_type;
    await db.pool.query(
      'UPDATE service_fields SET label=$1, field_type=$2, required=$3, order_index=$4 WHERE id=$5',
      [
        label ?? field.label,
        ft,
        required !== undefined ? (required ? 1 : 0) : field.required,
        order_index !== undefined ? order_index : field.order_index,
        id,
      ]
    );
    const updated = await db.prepare('SELECT * FROM service_fields WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const field = await db.prepare('SELECT * FROM service_fields WHERE id = ?').get(id);
    if (!field) return res.status(404).json({ error: 'Not found' });
    const clientId = req.user.clientId || null;
    if (clientId) {
      const svc = await db.prepare('SELECT id FROM services WHERE id = ? AND client_id = ?').get(field.service_id, clientId);
      if (!svc) return res.status(403).json({ error: 'Нет доступа' });
    }
    await db.prepare('DELETE FROM service_fields WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
