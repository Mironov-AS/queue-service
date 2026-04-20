require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const fs = require('fs');
const db = require('./database');

// ─── Storage setup ────────────────────────────────────────────────────────────

const S3_BUCKET = process.env.AWS_S3_BUCKET || '';
const S3_REGION = process.env.AWS_REGION || 'us-east-1';
const USE_S3 = !!(S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

// Local storage: used when S3 is not configured
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!USE_S3) {
  fs.mkdirSync(path.join(UPLOADS_DIR, 'ads'), { recursive: true });
}

const s3 = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  ...(process.env.AWS_ENDPOINT_URL ? {
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  } : {}),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Недопустимый тип файла. Разрешены: MP4, WebM, JPEG, PNG, GIF, WebP'));
  },
});

async function getAdUrl(fileKey) {
  if (!fileKey) return null;
  if (USE_S3) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }), { expiresIn: 3600 });
  }
  // Local storage: return static URL path
  return `/uploads/${fileKey}`;
}

async function enrichAds(ads) {
  return Promise.all(ads.map(async (ad) => {
    try { return { ...ad, url: await getAdUrl(ad.file_key) }; }
    catch { return { ...ad, url: null }; }
  }));
}

const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || '*';
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PUT', 'DELETE'] } });

app.set('trust proxy', 1);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '100kb' }));

// Serve locally-stored ad files
if (!USE_S3) {
  app.use('/uploads', express.static(UPLOADS_DIR));
}

// ─── Security headers ─────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: *; media-src blob: *; connect-src 'self' ws: wss: *;"
  );
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_FIELD_TYPES = ['text', 'phone', 'number', 'date', 'email', 'textarea'];

function sanitizeReason(val) {
  if (!val || typeof val !== 'string') return null;
  return val.trim().slice(0, 500) || null;
}

function getJwtSecret() {
  return process.env.JWT_SECRET || db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get().value;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' }
});

const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' }
});

function today() {
  return new Date().toISOString().split('T')[0];
}

function nextTicketNumber(d) {
  const idRow = db.prepare("SELECT value FROM settings WHERE key='queue_reset_last_id'").get();
  const lastId = parseInt(idRow?.value || '0', 10);
  const row = lastId
    ? db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=? AND id > ?").get(d, lastId)
    : db.prepare("SELECT MAX(number) AS max FROM tickets WHERE date=?").get(d);
  return (row?.max || 0) + 1;
}

function getQueueState() {
  const d = today();
  const current = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'called'
    ORDER BY t.called_at DESC LIMIT 1
  `).get(d);

  const waiting = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'waiting'
    ORDER BY t.is_priority DESC, t.created_at ASC
  `).all(d);

  const parse = (t) => t ? { ...t, field_values: t.field_values ? JSON.parse(t.field_values) : [] } : null;
  return { current: parse(current), waiting: waiting.map(parse) };
}

function getPublicQueueState() {
  const state = getQueueState();
  const stripPii = (t) => t ? {
    id: t.id, number: t.number, service_name: t.service_name,
    status: t.status, called_at: t.called_at, is_priority: t.is_priority
  } : null;
  const currentPublic = state.current ? {
    ...stripPii(state.current),
    field_values: state.current.field_values || []
  } : null;
  return {
    current: currentPublic,
    waiting: state.waiting.map(t => ({ ...stripPii(t), field_values: t.field_values || [] }))
  };
}

function emitQueueUpdate() {
  io.to('admins').emit('queue:updated', getQueueState());
  io.except('admins').emit('queue:updated', getPublicQueueState());
}

function log(req, action, details = '') {
  const username = req.user?.username || 'visitor';
  const userId = req.user?.id || null;
  db.prepare('INSERT INTO action_logs (user_id, username, action, details) VALUES (?,?,?,?)')
    .run(userId, username, action, details);
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── Auth middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    getJwtSecret(),
    { expiresIn: '24h' }
  );
  db.prepare('INSERT INTO action_logs (user_id, username, action) VALUES (?,?,?)').run(user.id, user.username, 'user.login');
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

app.get('/api/settings/registration', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
  res.json({ open: row?.value === '1' });
});

app.put('/api/settings/registration', requireAuth, (req, res) => {
  const { open } = req.body;
  const newVal = open ? '1' : '0';
  db.prepare("UPDATE settings SET value = ? WHERE key = 'registration_open'").run(newVal);
  log(req, 'settings.registration', newVal === '1' ? 'opened' : 'closed');
  io.emit('registration:changed', { open: newVal === '1' });
  res.json({ open: newVal === '1' });
});

app.get('/api/settings/auto-reset', requireAuth, (req, res) => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='auto_reset_enabled'").get();
  const time = db.prepare("SELECT value FROM settings WHERE key='auto_reset_time'").get();
  res.json({ enabled: enabled?.value === '1', time: time?.value || '00:00' });
});

app.put('/api/settings/auto-reset', requireAuth, (req, res) => {
  const { enabled, time } = req.body;
  const timeVal = typeof time === 'string' && /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_reset_enabled', ?)").run(enabled ? '1' : '0');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_reset_time', ?)").run(timeVal);
  log(req, 'settings.auto_reset', `${enabled ? 'on' : 'off'} at ${timeVal}`);
  res.json({ enabled: !!enabled, time: timeVal });
});

app.put('/api/settings/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  log(req, 'settings.password_changed');
  // Issue a fresh token with must_change_password: false
  const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const newToken = jwt.sign(
    { id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, must_change_password: false },
    getJwtSecret(),
    { expiresIn: '24h' }
  );
  res.json({ success: true, token: newToken });
});

// ─── Services ─────────────────────────────────────────────────────────────────

app.get('/api/services', (req, res) => {
  const all = req.query.all === '1';
  const rows = all
    ? db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY priority DESC, name').all()
    : db.prepare('SELECT * FROM services WHERE active = 1 AND enabled = 1 ORDER BY priority DESC, name').all();
  res.json(rows);
});

app.post('/api/services', requireAuth, (req, res) => {
  const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });
  const r = db.prepare(
    'INSERT INTO services (name, description, avg_duration_minutes, priority, daily_limit) VALUES (?,?,?,?,?)'
  ).run(name.trim(), description || null, avg_duration_minutes || 5, priority || 0, daily_limit || null);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(r.lastInsertRowid);
  log(req, 'service.created', name.trim());
  emitQueueUpdate();
  res.json(svc);
});

app.put('/api/services/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
  db.prepare(
    'UPDATE services SET name=?, description=?, avg_duration_minutes=?, priority=?, daily_limit=? WHERE id=?'
  ).run(name, description || null, avg_duration_minutes, priority || 0, daily_limit || null, id);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  log(req, 'service.updated', name);
  res.json(svc);
});

app.put('/api/services/:id/set-default', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  if (svc.is_default) {
    db.prepare('UPDATE services SET is_default = 0 WHERE id = ?').run(id);
    log(req, 'service.unset_default', svc.name);
  } else {
    db.prepare('UPDATE services SET is_default = 0').run();
    db.prepare('UPDATE services SET is_default = 1 WHERE id = ?').run(id);
    log(req, 'service.set_default', svc.name);
  }
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
});

app.put('/api/services/:id/toggle', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const newEnabled = svc.enabled ? 0 : 1;
  db.prepare('UPDATE services SET enabled = ? WHERE id = ?').run(newEnabled, id);
  log(req, newEnabled ? 'service.enabled' : 'service.disabled', svc.name);
  res.json({ ...svc, enabled: newEnabled });
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
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
  log(req, 'service.deleted', svc.name);
  emitQueueUpdate();
  res.json({ success: true });
});

// ─── Service fields ───────────────────────────────────────────────────────────

app.get('/api/services/:id/fields', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const fields = db.prepare(
    'SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC'
  ).all(id);
  res.json(fields);
});

app.post('/api/services/:id/fields', requireAuth, (req, res) => {
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

app.put('/api/service-fields/:id', requireAuth, (req, res) => {
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

app.delete('/api/service-fields/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  db.prepare('DELETE FROM service_fields WHERE id = ?').run(id);
  res.json({ success: true });
});

// ─── Tickets ──────────────────────────────────────────────────────────────────

app.post('/api/tickets', ticketLimiter, (req, res) => {
  const { service_id, name, phone, field_values } = req.body;
  const d = today();

  // Basic input validation
  if (name && (typeof name !== 'string' || name.length > 100)) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  if (phone && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Некорректный телефон' });
  }

  // Check registration open
  const regRow = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
  if (regRow?.value !== '1') {
    return res.status(403).json({ error: 'Самостоятельная запись временно недоступна' });
  }

  // Check daily limit
  if (service_id) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1 AND enabled = 1').get(service_id);
    if (!svc) return res.status(400).json({ error: 'Услуга недоступна' });
    if (svc.daily_limit) {
      const todayCount = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE date = ? AND service_id = ?").get(d, service_id);
      if (todayCount.c >= svc.daily_limit) {
        return res.status(400).json({ error: 'Достигнут дневной лимит талонов для этой услуги' });
      }
    }
  }

  const number = nextTicketNumber(d);

  const fvJson = field_values ? JSON.stringify(field_values) : null;

  const r = db.prepare(
    'INSERT INTO tickets (number, date, service_id, name, phone, field_values, status) VALUES (?,?,?,?,?,?,?)'
  ).run(number, d, service_id || null, name || null, phone || null, fvJson, 'waiting');

  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(r.lastInsertRowid);

  emitQueueUpdate();

  const queue = getQueueState();
  const position = queue.waiting.findIndex(t => t.id === ticket.id) + 1;

  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position });
});

// Manual registration (admin only)
app.post('/api/tickets/manual', requireAuth, (req, res) => {
  const { service_id, name, phone, is_priority, field_values } = req.body;
  const d = today();

  if (name && (typeof name !== 'string' || name.length > 100)) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  if (phone && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Некорректный телефон' });
  }

  const number = nextTicketNumber(d);
  const fvJson = field_values?.length ? JSON.stringify(field_values) : null;

  const r = db.prepare(
    'INSERT INTO tickets (number, date, service_id, name, phone, is_priority, field_values, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run(number, d, service_id || null, name || null, phone || null, is_priority ? 1 : 0, fvJson, 'waiting');

  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(r.lastInsertRowid);

  log(req, 'ticket.manual', `#${number} ${name || ''} ${phone || ''}`);
  emitQueueUpdate();
  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [] });
});

app.get('/api/tickets/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ticket = db.prepare(`
    SELECT t.id, t.number, t.date, t.status, t.service_id, t.is_priority,
           t.created_at, t.called_at, t.served_at, t.field_values,
           s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);

  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  let position = 0, estimatedWait = null;
  if (ticket.status === 'waiting') {
    const queue = getQueueState();
    const idx = queue.waiting.findIndex(t => t.id === ticket.id);
    position = idx >= 0 ? idx + 1 : 0;
    estimatedWait = ticket.avg_duration_minutes > 0 ? position * ticket.avg_duration_minutes : null;
  }

  res.json({ ...ticket, field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [], position, estimatedWait });
});

app.delete('/api/tickets/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const reason = sanitizeReason(req.body?.reason);
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (!['waiting', 'called'].includes(ticket.status)) {
    return res.status(400).json({ error: 'Талон уже не активен' });
  }
  db.prepare(
    "UPDATE tickets SET status = 'served', served_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(id);
  emitQueueUpdate();
  res.json({ success: true });
});

// Edit ticket (admin only)
app.put('/api/tickets/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  const { name, phone, service_id, is_priority, field_values, status } = req.body;

  if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 100)) {
    return res.status(400).json({ error: 'Некорректное имя' });
  }
  if (phone !== undefined && phone !== null && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Некорректный телефон' });
  }

  const VALID_STATUSES = ['waiting', 'called', 'served'];
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }

  const svcId = service_id !== undefined ? (parseId(service_id) || null) : ticket.service_id;
  const newName = name !== undefined ? (typeof name === 'string' ? name.trim() || null : null) : ticket.name;
  const newPhone = phone !== undefined ? (typeof phone === 'string' ? phone.trim() || null : null) : ticket.phone;
  const newIsPriority = is_priority !== undefined ? (is_priority ? 1 : 0) : ticket.is_priority;
  const newFieldValues = field_values !== undefined
    ? (Array.isArray(field_values) && field_values.length ? JSON.stringify(field_values) : null)
    : ticket.field_values;
  const newStatus = status !== undefined ? status : ticket.status;

  db.prepare(`
    UPDATE tickets SET
      name=?, phone=?, service_id=?, is_priority=?, field_values=?, status=?
    WHERE id=?
  `).run(newName, newPhone, svcId, newIsPriority, newFieldValues, newStatus, id);

  const updated = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);

  log(req, 'ticket.edited', `#${ticket.number}`);
  emitQueueUpdate();
  res.json({ ...updated, field_values: updated.field_values ? JSON.parse(updated.field_values) : [] });
});

app.put('/api/tickets/:id/transfer', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { service_id } = req.body;
  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  const svcId = parseId(service_id);
  if (!svcId) return res.status(400).json({ error: 'Некорректный service_id' });
  db.prepare('UPDATE tickets SET service_id = ? WHERE id = ?').run(svcId, id);
  const newSvc = db.prepare('SELECT name FROM services WHERE id = ?').get(svcId);
  log(req, 'ticket.transferred', `#${ticket.number}: ${ticket.service_name} → ${newSvc?.name}`);
  emitQueueUpdate();
  res.json(db.prepare('SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?').get(id));
});

// ─── Queue ────────────────────────────────────────────────────────────────────

app.get('/api/queue', (req, res) => {
  res.json(getPublicQueueState());
});

app.get('/api/queue/full', requireAuth, (req, res) => {
  res.json(getQueueState());
});

const _callNextTx = db.transaction((d) => {
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
  }
  return next || null;
});

function doCallNext(req) {
  const d = today();
  const next = _callNextTx(d);
  if (next) {
    const updated = db.prepare(`
      SELECT t.*, s.name AS service_name
      FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?
    `).get(next.id);
    io.emit('ticket:called', updated);
    if (req) log(req, 'ticket.called', `#${next.number}`);
  }
  emitQueueUpdate();
  return getQueueState();
}

app.post('/api/queue/next', requireAuth, (req, res) => {
  res.json(doCallNext(req));
});

app.post('/api/queue/call/:id', requireAuth, (req, res) => {
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
  io.emit('ticket:called', updated);
  log(req, 'ticket.called', `#${target.number}`);

  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/repeat', requireAuth, (req, res) => {
  const d = today();
  const current = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date = ? AND t.status = 'called' LIMIT 1
  `).get(d);
  if (current) {
    io.emit('ticket:called', current);
    log(req, 'ticket.called.repeat', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/return', requireAuth, (req, res) => {
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='waiting', called_at=NULL WHERE id=?").run(current.id);
    log(req, 'ticket.returned', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/return/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
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

app.post('/api/queue/return-all', requireAuth, (req, res) => {
  const d = today();
  const result = db.prepare(
    "UPDATE tickets SET status='waiting', called_at=NULL, served_at=NULL WHERE date=? AND status IN ('called','served')"
  ).run(d);
  log(req, 'queue.return_all', `${result.changes} талонов возвращено в очередь`);
  emitQueueUpdate();
  res.json({ success: true, returned: result.changes, ...getQueueState() });
});

app.post('/api/queue/skip', requireAuth, (req, res) => {
  const reason = sanitizeReason(req.body?.reason);
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
    log(req, 'ticket.served', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/complete', requireAuth, (req, res) => {
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
    log(req, 'ticket.served', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/cancel-current', requireAuth, (req, res) => {
  const reason = sanitizeReason(req.body?.reason);
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
    log(req, 'ticket.served', `#${current.number}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/reset', requireAuth, (req, res) => {
  const d = today();
  db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE date=? AND status IN ('waiting','called')").run(d);
  const lastTicket = db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=?").get(d);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_reset_last_id', ?)").run(String(lastTicket?.max_id || 0));
  log(req, 'queue.reset', d);
  emitQueueUpdate();
  res.json({ success: true });
});

// All today's tickets (admin view)
app.get('/api/tickets', requireAuth, (req, res) => {
  const rawDate = req.query.date;
  const d = rawDate && DATE_RE.test(rawDate) ? rawDate : today();
  const VALID_STATUSES = ['waiting', 'called', 'served'];
  const status = req.query.status && VALID_STATUSES.includes(req.query.status) ? req.query.status : null;
  const service_id = parseId(req.query.service_id) || null;

  let q = `SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.date = ?`;
  const params = [d];
  if (status) { q += ' AND t.status = ?'; params.push(status); }
  if (service_id) { q += ' AND t.service_id = ?'; params.push(service_id); }
  q += ' ORDER BY t.created_at DESC';

  const rows = db.prepare(q).all(...params).map(t => ({
    ...t,
    field_values: t.field_values ? JSON.parse(t.field_values) : []
  }));
  res.json(rows);
});

// ─── Statistics ───────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const days = clampInt(req.query.days, 1, 365, 7);
  const rows = db.prepare(`
    SELECT
      t.date,
      COALESCE(s.name, 'Без услуги') AS service_name,
      COUNT(*) AS total,
      SUM(CASE WHEN t.status='served' THEN 1 ELSE 0 END) AS served,
      SUM(CASE WHEN t.status IN ('waiting','called') THEN 1 ELSE 0 END) AS in_queue,
      ROUND(AVG(CASE WHEN t.served_at IS NOT NULL
        THEN (julianday(t.served_at)-julianday(t.created_at))*1440 ELSE NULL END),1) AS avg_wait_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date >= date('now', '-' || ? || ' days')
    GROUP BY t.date, t.service_id ORDER BY t.date DESC, s.name
  `).all(days - 1);

  const daily = db.prepare(`
    SELECT date,
      COUNT(*) AS total,
      SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served,
      ROUND(AVG(CASE WHEN served_at IS NOT NULL
        THEN (julianday(served_at)-julianday(created_at))*1440 ELSE NULL END),1) AS avg_wait_minutes
    FROM tickets
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date ORDER BY date DESC
  `).all(days - 1);

  res.json({ rows, daily });
});

app.get('/api/stats/export', requireAuth, (req, res) => {
  const days = clampInt(req.query.days, 1, 365, 30);
  const rows = db.prepare(`
    SELECT t.date, t.number, COALESCE(s.name,'Без услуги') AS service,
      t.status, t.name AS visitor_name, t.phone,
      t.created_at, t.called_at, t.served_at,
      t.skip_reason, t.cancel_reason,
      ROUND(CASE WHEN t.served_at IS NOT NULL
        THEN (julianday(t.served_at)-julianday(t.created_at))*1440 ELSE NULL END,1) AS wait_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.date >= date('now', '-' || ? || ' days')
    ORDER BY t.date DESC, t.number
  `).all(days - 1);

  const headers = ['Дата','Номер','Услуга','Статус','Имя','Телефон','Получен','Вызван','Обслужен','Причина пропуска','Причина отмены','Ожидание (мин)'];
  const csvRows = [headers.join(';')];
  for (const r of rows) {
    const safeCsv = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      // Prefix formula injection chars
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    csvRows.push([
      r.date, r.number, r.service, r.status, r.visitor_name||'', r.phone||'',
      r.created_at||'', r.called_at||'', r.served_at||'',
      r.skip_reason||'', r.cancel_reason||'', r.wait_minutes||''
    ].map(safeCsv).join(';'));
  }

  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="queue_stats_${today()}.csv"`);
  res.send(bom + csvRows.join('\n'));
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

app.get('/api/logs', requireAuth, (req, res) => {
  const limit = clampInt(req.query.limit, 1, 1000, 100);
  const rows = db.prepare(
    'SELECT * FROM action_logs ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  res.json(rows);
});

// ─── QR Code ──────────────────────────────────────────────────────────────────

app.get('/api/qrcode', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string' || url.length > 2048) {
    return res.status(400).json({ error: 'Некорректный url' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400, margin: 2,
      color: { dark: '#1e3a5f', light: '#ffffff' }
    });
    res.json({ qrcode: dataUrl, url });
  } catch {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

app.get('/api/qrcode/download', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string' || url.length > 2048) {
    return res.status(400).json({ error: 'Некорректный url' });
  }
  try {
    const buffer = await QRCode.toBuffer(url, {
      width: 400, margin: 2,
      color: { dark: '#1e3a5f', light: '#ffffff' }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="qrcode.png"');
    res.send(buffer);
  } catch {
    res.status(500).json({ error: 'Ошибка генерации QR-кода' });
  }
});

// ─── Users (admin only) ──────────────────────────────────────────────────────

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
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

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
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

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
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

app.put('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
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

// ─── Advertisements ───────────────────────────────────────────────────────────

// GET /api/ads — public, approved active ads only (for dashboard)
app.get('/api/ads', async (req, res) => {
  const ads = db.prepare("SELECT * FROM advertisements WHERE active = 1 AND (status IS NULL OR status = 'approved') ORDER BY order_index ASC, id ASC").all();
  res.json(await enrichAds(ads));
});

// GET /api/ads/all — admin sees all, others see only own
app.get('/api/ads/all', requireAuth, async (req, res) => {
  let ads;
  if (req.user.role === 'admin') {
    ads = db.prepare('SELECT * FROM advertisements ORDER BY order_index ASC, id ASC').all();
  } else {
    ads = db.prepare('SELECT * FROM advertisements WHERE owner_id = ? ORDER BY order_index ASC, id ASC').all(req.user.id);
  }
  res.json(await enrichAds(ads));
});

// POST /api/ads — upload new ad
app.post('/api/ads', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой (максимум 200 МБ)' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Файл обязателен' });

    const { name, duration } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Название обязательно' });

    const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `ads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    try {
      if (USE_S3) {
        await s3.send(new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }));
      } else {
        // Local filesystem storage
        const filePath = path.join(UPLOADS_DIR, key);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, req.file.buffer);
      }

      const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements').get();
      const adStatus = req.user.role === 'admin' ? 'approved' : 'pending';
      const r = db.prepare(
        'INSERT INTO advertisements (name, file_key, file_type, mime_type, duration, order_index, owner_id, owner_username, status) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(name.trim(), key, fileType, req.file.mimetype, parseInt(duration, 10) || 15, maxOrder.m + 1, req.user.id, req.user.username, adStatus);

      const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(r.lastInsertRowid);
      const url = await getAdUrl(key);
      log(req, 'ad.created', name.trim());
      io.emit('ads:updated');
      res.json({ ...ad, url });
    } catch (e) {
      console.error('Ad upload error:', e);
      res.status(500).json({ error: 'Ошибка загрузки: ' + e.message });
    }
  });
});

// PUT /api/ads/:id — update ad metadata
app.put('/api/ads/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
  if (!ad) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && ad.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const { name, duration, active, order_index } = req.body;
  // Only admin can change order_index; non-admin can change name, duration, active
  const newOrderIndex = (isAdmin && order_index !== undefined)
    ? parseInt(order_index, 10)
    : ad.order_index;

  db.prepare('UPDATE advertisements SET name=?, duration=?, active=?, order_index=? WHERE id=?').run(
    name !== undefined ? String(name).trim() || ad.name : ad.name,
    duration !== undefined ? (parseInt(duration, 10) || ad.duration) : ad.duration,
    active !== undefined ? (active ? 1 : 0) : ad.active,
    newOrderIndex,
    id
  );
  log(req, 'ad.updated', ad.name);
  io.emit('ads:updated');
  res.json(db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id));
});

// DELETE /api/ads/:id
app.delete('/api/ads/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
  if (!ad) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && ad.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  if (USE_S3 && ad.file_key) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: ad.file_key })); }
    catch (e) { console.error('S3 delete error:', e); }
  } else if (!USE_S3 && ad.file_key) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, ad.file_key)); }
    catch (e) { console.error('Local file delete error:', e); }
  }
  db.prepare('DELETE FROM advertisements WHERE id = ?').run(id);
  log(req, 'ad.deleted', ad.name);
  io.emit('ads:updated');
  res.json({ success: true });
});

// PUT /api/ads/:id/status — admin only: approve or reject a campaign
app.put('/api/ads/:id/status', requireAuth, requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Статус должен быть: pending, approved, rejected' });
  }
  const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
  if (!ad) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE advertisements SET status = ? WHERE id = ?').run(status, id);
  log(req, 'ad.status_changed', `${ad.name} → ${status}`);
  io.emit('ads:updated');
  res.json(db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id));
});

// GET /api/settings/ads
app.get('/api/settings/ads', (req, res) => {
  const t = db.prepare("SELECT value FROM settings WHERE key='ad_ticket_display_time'").get();
  const d = db.prepare("SELECT value FROM settings WHERE key='ad_dashboard_idle_time'").get();
  res.json({
    ticket_display_time: parseInt(t?.value || '10', 10),
    dashboard_idle_time: parseInt(d?.value || '15', 10),
    s3_configured: USE_S3,
    storage_type: USE_S3 ? 's3' : 'local',
  });
});

// PUT /api/settings/ads
app.put('/api/settings/ads', requireAuth, (req, res) => {
  const { ticket_display_time, dashboard_idle_time } = req.body;
  const t = clampInt(ticket_display_time, 3, 300, 10);
  const d = clampInt(dashboard_idle_time, 3, 300, 15);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_ticket_display_time', ?)").run(String(t));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_dashboard_idle_time', ?)").run(String(d));
  log(req, 'settings.ads', `ticket_display_time=${t} dashboard_idle_time=${d}`);
  io.emit('ads:config', { ticket_display_time: t, dashboard_idle_time: d });
  res.json({ ticket_display_time: t, dashboard_idle_time: d, s3_configured: USE_S3, storage_type: USE_S3 ? 's3' : 'local' });
});

// ─── Static frontend (production) ────────────────────────────────────────────

const publicDir = path.join(__dirname, 'public');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

// Optional auth: admins get full queue state (with PII), public gets stripped
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (token) {
      socket.data.user = jwt.verify(token, getJwtSecret());
      socket.data.isAdmin = true;
    } else {
      socket.data.isAdmin = false;
    }
  } catch {
    socket.data.isAdmin = false;
  }
  next();
});

io.on('connection', (socket) => {
  if (socket.data.isAdmin) {
    socket.join('admins');
    socket.emit('queue:updated', getQueueState());
  } else {
    socket.emit('queue:updated', getPublicQueueState());
  }
  // Send current ad settings to new connections
  const t = db.prepare("SELECT value FROM settings WHERE key='ad_ticket_display_time'").get();
  const d = db.prepare("SELECT value FROM settings WHERE key='ad_dashboard_idle_time'").get();
  socket.emit('ads:config', {
    ticket_display_time: parseInt(t?.value || '10', 10),
    dashboard_idle_time: parseInt(d?.value || '15', 10),
  });
});

// ─── Auto-reset scheduler ─────────────────────────────────────────────────────

function runAutoReset() {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='auto_reset_enabled'").get();
  if (enabled?.value !== '1') return;
  const timeSetting = db.prepare("SELECT value FROM settings WHERE key='auto_reset_time'").get();
  const resetTime = timeSetting?.value || '00:00';
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;
  if (currentTime !== resetTime) return;
  const d = today();
  const lastReset = db.prepare("SELECT value FROM settings WHERE key='auto_reset_last_date'").get();
  if (lastReset?.value === d) return; // already reset today
  db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE date=? AND status IN ('waiting','called')").run(d);
  const lastTicket = db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=?").get(d);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('queue_reset_last_id', ?)").run(String(lastTicket?.max_id || 0));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_reset_last_date', ?)").run(d);
  console.log(`[auto-reset] Queue auto-reset executed at ${currentTime}`);
  emitQueueUpdate();
}

setInterval(runAutoReset, 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Queue server on http://0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});
