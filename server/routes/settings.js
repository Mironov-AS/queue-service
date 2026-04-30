const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { log } = require('../services/logging');

const router = express.Router();

function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

router.get('/registration', async (req, res, next) => {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
    res.json({ open: row?.value === '1' });
  } catch (err) { next(err); }
});

router.put('/registration', requireAuth, async (req, res, next) => {
  try {
    const { open } = req.body;
    const newVal = open ? '1' : '0';
    await db.pool.query("UPDATE settings SET value = $1 WHERE key = 'registration_open'", [newVal]);
    await log(req, 'settings.registration', newVal === '1' ? 'opened' : 'closed');
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('registration:changed', { open: newVal === '1' });
    res.json({ open: newVal === '1' });
  } catch (err) { next(err); }
});

router.get('/auto-reset', requireAuth, async (req, res, next) => {
  try {
    const enabled = await db.prepare("SELECT value FROM settings WHERE key='auto_reset_enabled'").get();
    const time = await db.prepare("SELECT value FROM settings WHERE key='auto_reset_time'").get();
    res.json({ enabled: enabled?.value === '1', time: time?.value || '00:00' });
  } catch (err) { next(err); }
});

router.put('/auto-reset', requireAuth, async (req, res, next) => {
  try {
    const { enabled, time } = req.body;
    const timeVal = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('auto_reset_enabled', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [enabled ? '1' : '0']);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('auto_reset_time', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [timeVal]);
    await log(req, 'settings.auto_reset', `${enabled ? 'on' : 'off'} at ${timeVal}`);
    res.json({ enabled: !!enabled, time: timeVal });
  } catch (err) { next(err); }
});

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getJwtSecret } = require('../config');

router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
    }
    await db.pool.query('UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2', [bcrypt.hashSync(newPassword, 10), req.user.id]);
    await log(req, 'settings.password_changed');
    const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const secret = await getJwtSecret();
    const newToken = jwt.sign(
      { id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, must_change_password: false },
      secret,
      { expiresIn: '24h' }
    );
    res.json({ success: true, token: newToken });
  } catch (err) { next(err); }
});

router.get('/ads', async (req, res, next) => {
  try {
    const t = await db.prepare("SELECT value FROM settings WHERE key='ad_ticket_display_time'").get();
    const d = await db.prepare("SELECT value FROM settings WHERE key='ad_dashboard_idle_time'").get();
    const iv = await db.prepare("SELECT value FROM settings WHERE key='ad_dashboard_interval'").get();
    const ab = await db.prepare("SELECT value FROM settings WHERE key='ad_ads_before_dashboard'").get();
    const { USE_S3 } = require('../services/storage');
    res.json({
      ticket_display_time: parseInt(t?.value || '10', 10),
      dashboard_idle_time: parseInt(d?.value || '15', 10),
      dashboard_interval: parseInt(iv?.value || '0', 10),
      ads_before_dashboard: parseInt(ab?.value || '0', 10),
      s3_configured: USE_S3,
      storage_type: USE_S3 ? 's3' : 'local',
    });
  } catch (err) { next(err); }
});

router.put('/ads', requireAuth, async (req, res, next) => {
  try {
    const { ticket_display_time, dashboard_idle_time, dashboard_interval, ads_before_dashboard } = req.body;
    const t = clampInt(ticket_display_time, 3, 300, 10);
    const d = clampInt(dashboard_idle_time, 3, 300, 15);
    const iv = clampInt(dashboard_interval, 0, 100, 0);
    const ab = clampInt(ads_before_dashboard, 0, 100, 0);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('ad_ticket_display_time', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(t)]);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('ad_dashboard_idle_time', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(d)]);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('ad_dashboard_interval', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(iv)]);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('ad_ads_before_dashboard', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(ab)]);
    await log(req, 'settings.ads', `ticket_display_time=${t} dashboard_idle_time=${d} dashboard_interval=${iv} ads_before_dashboard=${ab}`);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ads:config', { ticket_display_time: t, dashboard_idle_time: d, dashboard_interval: iv, ads_before_dashboard: ab });
    const { USE_S3 } = require('../services/storage');
    res.json({ ticket_display_time: t, dashboard_idle_time: d, dashboard_interval: iv, ads_before_dashboard: ab, s3_configured: USE_S3, storage_type: USE_S3 ? 's3' : 'local' });
  } catch (err) { next(err); }
});

module.exports = router;
