const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

const VALID_FIELD_TYPES = ['text', 'phone', 'number', 'date', 'email', 'textarea'];

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/:id/fields', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const fields = db.prepare(
    'SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC'
  ).all(id);
  res.json(fields);
});

router.post('/:id/fields', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { label, field_type, required } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Название поля обязательно' });
  const ft = field_type && VALID_FIELD_TYPES.includes(field_type) ? field_type : 'text';
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(order_index), -1) AS m FROM service_fields WHERE service_id = ?'
  ).get(id);
  const r = db.prepare(
    'INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES (?,?,?,?,?)'
  ).run(id, label.trim(), ft, required ? 1 : 0, maxOrder.m + 1);
  res.json(db.prepare('SELECT * FROM service_fields WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { label, field_type, required, order_index } = req.body;
  const field = db.prepare('SELECT * FROM service_fields WHERE id = ?').get(id);
  if (!field) return res.status(404).json({ error: 'Not found' });
  const ft = field_type
    ? (VALID_FIELD_TYPES.includes(field_type) ? field_type : field.field_type)
    : field.field_type;
  db.prepare(
    'UPDATE service_fields SET label=?, field_type=?, required=?, order_index=? WHERE id=?'
  ).run(
    label ?? field.label,
    ft,
    required !== undefined ? (required ? 1 : 0) : field.required,
    order_index !== undefined ? order_index : field.order_index,
    id
  );
  res.json(db.prepare('SELECT * FROM service_fields WHERE id = ?').get(id));
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  db.prepare('DELETE FROM service_fields WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;