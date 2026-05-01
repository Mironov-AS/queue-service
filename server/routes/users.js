const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { log } = require('../services/logging');

const router = express.Router();

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await db.prepare(`
      SELECT u.id, u.username, u.role, u.created_at,
        COUNT(a.id) AS campaigns_total
      FROM users u
      LEFT JOIN advertisements a ON a.owner_id = u.id
      GROUP BY u.id, u.username, u.role, u.created_at
      ORDER BY u.id ASC
    `).all();
    res.json(users.map(u => ({
      ...u,
      campaigns_total: parseInt(u.campaigns_total) || 0,
    })));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role } = req.body;
    if (!username?.trim() || !password || !role) {
      return res.status(400).json({ error: 'Логин, пароль и роль обязательны' });
    }
    if (!['operator', 'advertiser'].includes(role)) {
      return res.status(400).json({ error: 'Роль должна быть operator или advertiser' });
    }
    if (username.trim().length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
    if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
    if (existing) return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await db.pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [username.trim(), hash, role]
    );
    await log(req, 'user.created', username.trim());
    res.json({ id: rows[0].id, username: username.trim(), role, created_at: new Date().toISOString(), campaigns_total: 0 });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Нельзя удалить администратора' });
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
    await log(req, 'user.deleted', user.username);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:id/password', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    await log(req, 'user.password_reset', user.username);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
