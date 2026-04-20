const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { log } = require('../services/logging');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at,
      COUNT(a.id) AS campaigns_total,
      SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS campaigns_pending
    FROM users u
    LEFT JOIN advertisements a ON a.owner_id = u.id
    GROUP BY u.id
    ORDER BY u.id ASC
  `).all();
  res.json(users.map(u => ({ ...u, campaigns_total: u.campaigns_total || 0, campaigns_pending: u.campaigns_pending || 0 })));
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username?.trim() || !password || !role) {
    return res.status(400).json({ error: 'Логин, пароль и роль обязательны' });
  }
  if (!['operator', 'advertiser'].includes(role)) {
    return res.status(400).json({ error: 'Роль должна быть operator или advertiser' });
  }
  if (username.trim().length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username.trim(), hash, role);
  log(req, 'user.created', username.trim());
  res.json({ id: r.lastInsertRowid, username: username.trim(), role, created_at: new Date().toISOString(), campaigns_total: 0, campaigns_pending: 0 });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Нельзя удалить администратора' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  log(req, 'user.deleted', user.username);
  res.json({ success: true });
});

router.put('/:id/password', requireAuth, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  log(req, 'user.password_reset', user.username);
  res.json({ success: true });
});

module.exports = router;