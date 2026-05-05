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
const log = require('./services/logger');

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

function sanitizeClientId(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : null;
}

io.on('connection', async (socket) => {
  try {
    let clientId = null;

    if (socket.data.isAdmin && socket.data.user?.clientId) {
      clientId = socket.data.user.clientId;
      socket.join(`admin:${clientId}`);
      socket.emit('queue:updated', await getQueueState(clientId));
    } else if (socket.data.isAdmin && !socket.data.user?.clientId) {
      socket.emit('queue:updated', { current: null, waiting: [] });
    } else if (!socket.data.isAdmin) {
      clientId = sanitizeClientId(socket.handshake.query?.client_id);
      if (clientId) {
        socket.join(`public:${clientId}`);
        socket.emit('queue:updated', await getPublicQueueState(clientId));
      }
    }

    socket.data.clientId = clientId;

    socket.on('join:client', async (data) => {
      const cid = sanitizeClientId(data?.client_id);
      if (!cid) return;
      if (socket.data.clientId) socket.leave(`public:${socket.data.clientId}`);
      socket.join(`public:${cid}`);
      socket.data.clientId = cid;
      socket.emit('queue:updated', await getPublicQueueState(cid));
    });

    const { getClientSetting } = require('./database');
    const adClientId = clientId || null;
    const adTicketTime = await getClientSetting('ad_ticket_display_time', adClientId, '10');
    const adDashTime = await getClientSetting('ad_dashboard_idle_time', adClientId, '15');
    const adBefore = await getClientSetting('ad_ads_before_dashboard', adClientId, '0');
    socket.emit('ads:config', {
      ticket_display_time: parseInt(adTicketTime, 10),
      dashboard_idle_time: parseInt(adDashTime, 10),
      ads_before_dashboard: parseInt(adBefore, 10),
    });
  } catch (err) {
    log.error('socket', 'connection handler error:', err);
  }
});

// ─── Auto-reset scheduler ─────────────────────────────────────────────────────
async function runAutoReset() {
  try {
    const { getClientSetting, setClientSetting } = require('./database');
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    const d = today();

    const { rows: clientRows } = await db.pool.query(
      "SELECT DISTINCT client_id FROM settings WHERE key = 'auto_reset_enabled' AND value = '1' AND client_id != ''"
    );

    for (const { client_id: cid } of clientRows) {
      try {
        const resetTime = await getClientSetting('auto_reset_time', cid, '00:00');
        if (currentTime !== resetTime) continue;
        const lastDate = await getClientSetting('auto_reset_last_date', cid, '');
        if (lastDate === d) continue;

        await db.pool.query(
          "UPDATE tickets SET status='served', served_at=NOW() WHERE date=$1 AND status IN ('waiting','called') AND client_id=$2",
          [d, cid]
        );
        const maxRow = await db.pool.query(
          "SELECT MAX(id) AS max_id FROM tickets WHERE date=$1 AND client_id=$2",
          [d, cid]
        );
        await setClientSetting('queue_reset_last_id', String(maxRow.rows[0]?.max_id || 0), cid);
        await setClientSetting('auto_reset_last_date', d, cid);
        log.info('auto-reset', `Queue reset for client ${cid} at ${currentTime}`);

        const { emitQueueUpdate } = require('./services/emitQueueUpdate');
        await emitQueueUpdate(cid);
      } catch (clientErr) {
        log.error('auto-reset', `Error for client ${cid}:`, clientErr);
      }
    }
  } catch (err) {
    log.error('auto-reset', 'Error:', err);
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
    log.info(null, `Server on http://0.0.0.0:${PORT}`);
  });
})();

function shutdown(signal) {
  log.info(null, `${signal} received — shutting down gracefully`);
  server.close(() => {
    db.pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error(null, 'Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  log.error(null, 'Uncaught exception:', err);
  shutdown('uncaughtException');
});
