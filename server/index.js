require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { db, initDb } = require('./database');
const { getJwtSecret } = require('./config');
const { setIo } = require('./services/socketSetup');
const { setIo: setEmitIo } = require('./services/emitQueueUpdate');
const { today } = require('./services/queueState');
const { USE_S3, UPLOADS_DIR } = require('./services/storage');

// ─── Route modules ────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const servicesRouter = require('./routes/services');
const serviceFieldsRouter = require('./routes/serviceFields');
const ticketsRouter = require('./routes/tickets');
const queueRouter = require('./routes/queue');
const statsRouter = require('./routes/stats');
const adsRouter = require('./routes/ads');
const usersRouter = require('./routes/users');
const settingsRouter = require('./routes/settings');
const qrRouter = require('./routes/qrcode');
const logsRouter = require('./routes/logs');

// ─── App setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || '*';
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST', 'PUT', 'DELETE'] } });

setIo(io);
setEmitIo(io);

app.set('trust proxy', 1);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '100kb' }));

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

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api/auth', authRouter);
app.use('/api/services', servicesRouter);
app.use('/api/services', serviceFieldsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/stats', statsRouter);
app.use('/api/ads', adsRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/qrcode', qrRouter);
app.use('/api/logs', logsRouter);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const { getQueueState, getPublicQueueState } = require('./services/queueState');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (token) {
      const secret = await getJwtSecret();
      const payload = jwt.verify(token, secret);
      socket.data.user = {
        id: payload.userId || payload.id,
        username: payload.email || payload.username,
        role: payload.role,
        clientId: payload.clientId || null,
      };
      socket.data.isAdmin = true;
    } else {
      socket.data.isAdmin = false;
    }
  } catch {
    socket.data.isAdmin = false;
  }
  next();
});

io.on('connection', async (socket) => {
  try {
    if (socket.data.isAdmin) {
      socket.join('admins');
      socket.emit('queue:updated', await getQueueState());
    } else {
      socket.emit('queue:updated', await getPublicQueueState());
    }
    const t = await db.prepare("SELECT value FROM settings WHERE key='ad_ticket_display_time'").get();
    const d = await db.prepare("SELECT value FROM settings WHERE key='ad_dashboard_idle_time'").get();
    const ab = await db.prepare("SELECT value FROM settings WHERE key='ad_ads_before_dashboard'").get();
    socket.emit('ads:config', {
      ticket_display_time: parseInt(t?.value || '10', 10),
      dashboard_idle_time: parseInt(d?.value || '15', 10),
      ads_before_dashboard: parseInt(ab?.value || '0', 10),
    });
  } catch (err) {
    console.error('[socket] connection handler error:', err);
  }
});

// ─── Auto-reset scheduler ─────────────────────────────────────────────────────
async function runAutoReset() {
  try {
    const enabled = await db.prepare("SELECT value FROM settings WHERE key='auto_reset_enabled'").get();
    if (enabled?.value !== '1') return;
    const timeSetting = await db.prepare("SELECT value FROM settings WHERE key='auto_reset_time'").get();
    const resetTime = timeSetting?.value || '00:00';
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    if (currentTime !== resetTime) return;
    const d = today();
    const lastReset = await db.prepare("SELECT value FROM settings WHERE key='auto_reset_last_date'").get();
    if (lastReset?.value === d) return;
    await db.pool.query("UPDATE tickets SET status='served', served_at=NOW() WHERE date=$1 AND status IN ('waiting','called')", [d]);
    const maxRow = await db.prepare("SELECT MAX(id) AS max_id FROM tickets WHERE date=?").get(d);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('queue_reset_last_id', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [String(maxRow?.max_id || 0)]);
    await db.pool.query("INSERT INTO settings (key, value) VALUES ('auto_reset_last_date', $1) ON CONFLICT(key) DO UPDATE SET value = $1", [d]);
    console.log(`[auto-reset] Queue auto-reset executed at ${currentTime}`);
    const { emitQueueUpdate } = require('./services/emitQueueUpdate');
    await emitQueueUpdate();
  } catch (err) {
    console.error('[auto-reset] Error:', err);
  }
}

setInterval(runAutoReset, 60 * 1000);

// ─── Static frontend (production) ────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

(async () => {
  await initDb();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Queue server on http://0.0.0.0:${PORT}`);
  });
})();

function shutdown(signal) {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    db.pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
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
