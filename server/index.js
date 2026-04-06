const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] } });

app.use(cors());
app.use(express.json());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getJwtSecret() {
  return db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get().value;
}

function today() {
  return new Date().toISOString().split('T')[0];
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

function emitQueueUpdate() {
  io.emit('queue:updated', getQueueState());
}

function log(req, action, details = '') {
  const username = req.user?.username || 'visitor';
  const userId = req.user?.id || null;
  db.prepare('INSERT INTO action_logs (user_id, username, action, details) VALUES (?,?,?,?)')
    .run(userId, username, action, details);
}

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

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
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
  const row = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
  const newVal = row?.value === '1' ? '0' : '1';
  db.prepare("UPDATE settings SET value = ? WHERE key = 'registration_open'").run(newVal);
  log(req, 'settings.registration', newVal === '1' ? 'opened' : 'closed');
  io.emit('registration:changed', { open: newVal === '1' });
  res.json({ open: newVal === '1' });
});

app.put('/api/settings/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Неверный текущий пароль' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  log(req, 'settings.password_changed');
  res.json({ success: true });
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
  const { name, description, avg_duration_minutes, priority, daily_limit } = req.body;
  db.prepare(
    'UPDATE services SET name=?, description=?, avg_duration_minutes=?, priority=?, daily_limit=? WHERE id=?'
  ).run(name, description || null, avg_duration_minutes, priority || 0, daily_limit || null, req.params.id);
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  log(req, 'service.updated', name);
  res.json(svc);
});

app.put('/api/services/:id/set-default', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  if (svc.is_default) {
    db.prepare('UPDATE services SET is_default = 0 WHERE id = ?').run(req.params.id);
    log(req, 'service.unset_default', svc.name);
  } else {
    db.prepare('UPDATE services SET is_default = 0').run();
    db.prepare('UPDATE services SET is_default = 1 WHERE id = ?').run(req.params.id);
    log(req, 'service.set_default', svc.name);
  }
  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

app.put('/api/services/:id/toggle', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  const newEnabled = svc.enabled ? 0 : 1;
  db.prepare('UPDATE services SET enabled = ? WHERE id = ?').run(newEnabled, req.params.id);
  log(req, newEnabled ? 'service.enabled' : 'service.disabled', svc.name);
  res.json({ ...svc, enabled: newEnabled });
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  // Move active tickets to null service
  const transferTo = req.body.transfer_to;
  if (transferTo) {
    db.prepare("UPDATE tickets SET service_id = ? WHERE service_id = ? AND status IN ('waiting','called')")
      .run(transferTo, req.params.id);
  }
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  log(req, 'service.deleted', svc.name);
  emitQueueUpdate();
  res.json({ success: true });
});

// ─── Service fields ───────────────────────────────────────────────────────────

app.get('/api/services/:id/fields', (req, res) => {
  const fields = db.prepare(
    'SELECT * FROM service_fields WHERE service_id = ? ORDER BY order_index ASC, id ASC'
  ).all(req.params.id);
  res.json(fields);
});

app.post('/api/services/:id/fields', requireAuth, (req, res) => {
  const { label, field_type, required } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Название поля обязательно' });
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(order_index), -1) AS m FROM service_fields WHERE service_id = ?'
  ).get(req.params.id);
  const r = db.prepare(
    'INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES (?,?,?,?,?)'
  ).run(req.params.id, label.trim(), field_type || 'text', required ? 1 : 0, maxOrder.m + 1);
  res.json(db.prepare('SELECT * FROM service_fields WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/service-fields/:id', requireAuth, (req, res) => {
  const { label, field_type, required, order_index } = req.body;
  const field = db.prepare('SELECT * FROM service_fields WHERE id = ?').get(req.params.id);
  if (!field) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'UPDATE service_fields SET label=?, field_type=?, required=?, order_index=? WHERE id=?'
  ).run(
    label ?? field.label,
    field_type ?? field.field_type,
    required !== undefined ? (required ? 1 : 0) : field.required,
    order_index !== undefined ? order_index : field.order_index,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM service_fields WHERE id = ?').get(req.params.id));
});

app.delete('/api/service-fields/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM service_fields WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Tickets ──────────────────────────────────────────────────────────────────

app.post('/api/tickets', (req, res) => {
  const { service_id, name, phone, field_values } = req.body;
  const d = today();

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

  const last = db.prepare('SELECT MAX(number) AS max FROM tickets WHERE date = ?').get(d);
  const number = (last.max || 0) + 1;

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

  const last = db.prepare('SELECT MAX(number) AS max FROM tickets WHERE date = ?').get(d);
  const number = (last.max || 0) + 1;
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
  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name, s.avg_duration_minutes
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Талон не найден' });

  let position = 0, estimatedWait = 0;
  if (ticket.status === 'waiting') {
    const queue = getQueueState();
    const idx = queue.waiting.findIndex(t => t.id === ticket.id);
    position = idx >= 0 ? idx + 1 : 0;
    estimatedWait = ticket.avg_duration_minutes > 0 ? position * ticket.avg_duration_minutes : null;
  }

  const parsedFieldValues = ticket.field_values ? JSON.parse(ticket.field_values) : [];

  res.json({ ...ticket, field_values: parsedFieldValues, position, estimatedWait });
});

app.delete('/api/tickets/:id', (req, res) => {
  const { reason } = req.body || {};
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (!['waiting', 'called'].includes(ticket.status)) {
    return res.status(400).json({ error: 'Талон уже не активен' });
  }
  db.prepare(
    "UPDATE tickets SET status = 'cancelled', cancel_reason = ? WHERE id = ?"
  ).run(reason || null, req.params.id);
  emitQueueUpdate();
  res.json({ success: true });
});

app.put('/api/tickets/:id/transfer', requireAuth, (req, res) => {
  const { service_id } = req.body;
  const ticket = db.prepare(`
    SELECT t.*, s.name AS service_name
    FROM tickets t LEFT JOIN services s ON t.service_id = s.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE tickets SET service_id = ? WHERE id = ?').run(service_id, req.params.id);
  const newSvc = db.prepare('SELECT name FROM services WHERE id = ?').get(service_id);
  log(req, 'ticket.transferred', `#${ticket.number}: ${ticket.service_name} → ${newSvc?.name}`);
  emitQueueUpdate();
  res.json(db.prepare('SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ?').get(req.params.id));
});

// ─── Queue ────────────────────────────────────────────────────────────────────

app.get('/api/queue', (req, res) => {
  res.json(getQueueState());
});

function doCallNext(req) {
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
  const d = today();
  const target = db.prepare(
    "SELECT t.*, s.name AS service_name FROM tickets t LEFT JOIN services s ON t.service_id = s.id WHERE t.id = ? AND t.date = ? AND t.status = 'waiting'"
  ).get(req.params.id, d);
  if (!target) return res.status(404).json({ error: 'Талон не найден в очереди' });

  // Complete current if any
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='served', served_at=CURRENT_TIMESTAMP WHERE id=?").run(current.id);
  }

  db.prepare("UPDATE tickets SET status='called', called_at=CURRENT_TIMESTAMP WHERE id=?").run(target.id);
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

app.post('/api/queue/skip', requireAuth, (req, res) => {
  const { reason } = req.body || {};
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='skipped', skip_reason=? WHERE id=?").run(reason || null, current.id);
    log(req, 'ticket.skipped', `#${current.number}${reason ? ': ' + reason : ''}`);
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
  const { reason } = req.body || {};
  const d = today();
  const current = db.prepare("SELECT * FROM tickets WHERE date = ? AND status = 'called' LIMIT 1").get(d);
  if (current) {
    db.prepare("UPDATE tickets SET status='cancelled', cancel_reason=? WHERE id=?").run(reason || null, current.id);
    log(req, 'ticket.cancelled', `#${current.number}${reason ? ': ' + reason : ''}`);
  }
  emitQueueUpdate();
  res.json(getQueueState());
});

app.post('/api/queue/reset', requireAuth, (req, res) => {
  const d = today();
  db.prepare("UPDATE tickets SET status='skipped' WHERE date=? AND status IN ('waiting','called')").run(d);
  log(req, 'queue.reset', d);
  emitQueueUpdate();
  res.json({ success: true });
});

// All today's tickets (admin view)
app.get('/api/tickets', requireAuth, (req, res) => {
  const d = req.query.date || today();
  const status = req.query.status;
  const service_id = req.query.service_id;

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
  const days = parseInt(req.query.days) || 7;
  const rows = db.prepare(`
    SELECT
      t.date,
      COALESCE(s.name, 'Без услуги') AS service_name,
      COUNT(*) AS total,
      SUM(CASE WHEN t.status='served' THEN 1 ELSE 0 END) AS served,
      SUM(CASE WHEN t.status IN ('waiting','called') THEN 1 ELSE 0 END) AS in_queue,
      SUM(CASE WHEN t.status='skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN t.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
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
      SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      ROUND(AVG(CASE WHEN served_at IS NOT NULL
        THEN (julianday(served_at)-julianday(created_at))*1440 ELSE NULL END),1) AS avg_wait_minutes
    FROM tickets
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date ORDER BY date DESC
  `).all(days - 1);

  res.json({ rows, daily });
});

app.get('/api/stats/export', requireAuth, (req, res) => {
  const days = parseInt(req.query.days) || 30;
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
    csvRows.push([
      r.date, r.number, r.service, r.status, r.visitor_name||'', r.phone||'',
      r.created_at||'', r.called_at||'', r.served_at||'',
      r.skip_reason||'', r.cancel_reason||'', r.wait_minutes||''
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'));
  }

  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="queue_stats_${today()}.csv"`);
  res.send(bom + csvRows.join('\n'));
});

// ─── Logs ─────────────────────────────────────────────────────────────────────

app.get('/api/logs', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const rows = db.prepare(
    'SELECT * FROM action_logs ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  res.json(rows);
});

// ─── QR Code ──────────────────────────────────────────────────────────────────

app.get('/api/qrcode', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: 400, margin: 2,
      color: { dark: '#1e3a5f', light: '#ffffff' }
    });
    res.json({ qrcode: dataUrl, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Static frontend (production) ────────────────────────────────────────────

const path = require('path');
const publicDir = path.join(__dirname, 'public');
const fs = require('fs');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.emit('queue:updated', getQueueState());
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Queue server on http://0.0.0.0:${PORT}`);
  console.log(`Default admin login: admin / admin`);
});
