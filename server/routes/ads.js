const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { getAdUrl, deleteAdFile, saveAdFile, makeAdKey, UPLOADS_DIR } = require('../services/storage');
const { log } = require('../services/logging');
const logger = require('../services/logger');

const router = express.Router();

// ── Chunk upload setup ─────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(UPLOADS_DIR, 'chunks');
fs.mkdirSync(CHUNK_DIR, { recursive: true });

function cleanupOldChunks() {
  try {
    const now = Date.now();
    const dirs = fs.readdirSync(CHUNK_DIR);
    for (const d of dirs) {
      const dPath = path.join(CHUNK_DIR, d);
      try {
        const stat = fs.statSync(dPath);
        if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
          fs.rmSync(dPath, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
setInterval(cleanupOldChunks, 30 * 60 * 1000);

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function parseId(val) {
  const id = parseInt(val, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Недопустимый тип файла. Разрешены: MP4, WebM, JPEG, PNG, GIF, WebP'));
  },
});

async function enrichAds(ads) {
  return Promise.all(ads.map(async (ad) => {
    try {
      const url = await getAdUrl(ad.file_key);
      return { ...ad, url };
    } catch (err) {
      logger.error('ads', `Failed to get URL for ad ${ad.id}:`, err.message);
      return { ...ad, url: null };
    }
  }));
}

function sanitizeClientId(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : null;
}

router.get('/', async (req, res, next) => {
  try {
    const clientId = sanitizeClientId(req.query.client_id);
    let ads;
    if (clientId) {
      ads = await db.prepare("SELECT * FROM advertisements WHERE active = 1 AND (client_id = ? OR client_id IS NULL) ORDER BY order_index ASC, id ASC").all(clientId);
    } else {
      ads = await db.prepare("SELECT * FROM advertisements WHERE active = 1 AND client_id IS NULL ORDER BY order_index ASC, id ASC").all();
    }
    res.json(await enrichAds(ads));
  } catch (err) { next(err); }
});

router.post('/chunk', requireAuth, (req, res) => {
  chunkUpload.single('chunk')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Чанк слишком большой (максимум 2 МБ)' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Данные чанка обязательны' });

    const { uploadId, index, total, mimeType, originalName, name, duration } = req.body;
    if (!uploadId || index === undefined || !total || !mimeType || !originalName || !name?.trim()) {
      return res.status(400).json({ error: 'Неполные параметры чанка' });
    }

    const ALLOWED = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED.includes(mimeType)) {
      return res.status(400).json({ error: 'Недопустимый тип файла' });
    }

    const chunkIndex = parseInt(index, 10);
    const totalChunks = parseInt(total, 10);

    const safeId = uploadId.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    if (!safeId) return res.status(400).json({ error: 'Некорректный uploadId' });

    const sessionDir = path.join(CHUNK_DIR, safeId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, req.file.buffer);

    const receivedChunks = fs.readdirSync(sessionDir).filter(f => f.startsWith('chunk_')).length;
    if (receivedChunks < totalChunks) {
      return res.json({ done: false, received: receivedChunks, total: totalChunks });
    }

    try {
      const parts = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(sessionDir, `chunk_${i}`);
        parts.push(fs.readFileSync(p));
      }
      const buffer = Buffer.concat(parts);

      fs.rmSync(sessionDir, { recursive: true, force: true });

      const ext = (originalName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = makeAdKey(ext, mimeType);
      const fileType = mimeType.startsWith('video/') ? 'video' : 'image';

      await saveAdFile(key, buffer, mimeType, originalName);

      const adClientId = req.user.clientId || null;
      const maxOrder = adClientId
        ? await db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements WHERE client_id = ?').get(adClientId)
        : await db.prepare("SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements WHERE client_id IS NULL").get();
      const adStatus = 'approved';
      const { rows } = await db.pool.query(
        'INSERT INTO advertisements (name, file_key, file_type, mime_type, duration, order_index, owner_id, owner_username, status, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [name.trim(), key, fileType, mimeType, parseInt(duration, 10) || 15, parseInt(maxOrder.m) + 1, req.user.id, req.user.username, adStatus, adClientId]
      );

      const ad = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(rows[0].id);
      const url = await getAdUrl(key);
      await log(req, 'ad.created', name.trim());
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.emit('ads:updated');

      return res.json({ done: true, ad: { ...ad, url } });
    } catch (e) {
      logger.error('ads', 'Chunk assembly error:', e);
      return res.status(500).json({ error: 'Ошибка сборки файла: ' + e.message });
    }
  });
});

router.get('/all', requireAuth, async (req, res, next) => {
  try {
    const clientId = req.user.clientId || null;
    let ads;
    if (clientId) {
      ads = await db.prepare('SELECT * FROM advertisements WHERE client_id = ? ORDER BY order_index ASC, id ASC').all(clientId);
    } else {
      ads = await db.prepare('SELECT * FROM advertisements WHERE client_id IS NULL ORDER BY order_index ASC, id ASC').all();
    }
    res.json(await enrichAds(ads));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, (req, res) => {
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
    const key = makeAdKey(ext, req.file.mimetype);

    try {
      await saveAdFile(key, req.file.buffer, req.file.mimetype, req.file.originalname);

      const adClientId = req.user.clientId || null;
      const maxOrder = adClientId
        ? await db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements WHERE client_id = ?').get(adClientId)
        : await db.prepare("SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements WHERE client_id IS NULL").get();
      const adStatus = 'approved';
      const { rows } = await db.pool.query(
        'INSERT INTO advertisements (name, file_key, file_type, mime_type, duration, order_index, owner_id, owner_username, status, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
        [name.trim(), key, fileType, req.file.mimetype, parseInt(duration, 10) || 15, parseInt(maxOrder.m) + 1, req.user.id, req.user.username, adStatus, adClientId]
      );

      const ad = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(rows[0].id);
      const url = await getAdUrl(key);
      await log(req, 'ad.created', name.trim());
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.emit('ads:updated');
      res.json({ ...ad, url });
    } catch (e) {
      logger.error('ads', 'Ad upload error:', e);
      res.status(500).json({ error: 'Ошибка загрузки: ' + e.message });
    }
  });
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const ad = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
    if (!ad) return res.status(404).json({ error: 'Not found' });

    const clientId = req.user.clientId || null;
    if (clientId && ad.client_id !== clientId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!clientId && ad.client_id) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const { name, duration, active, order_index } = req.body;
    const newOrderIndex = order_index !== undefined
      ? parseInt(order_index, 10)
      : ad.order_index;

    await db.pool.query('UPDATE advertisements SET name=$1, duration=$2, active=$3, order_index=$4 WHERE id=$5', [
      name !== undefined ? String(name).trim() || ad.name : ad.name,
      duration !== undefined ? (parseInt(duration, 10) || ad.duration) : ad.duration,
      active !== undefined ? (active ? 1 : 0) : ad.active,
      newOrderIndex,
      id,
    ]);
    await log(req, 'ad.updated', ad.name);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ads:updated');
    const updated = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const ad = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
    if (!ad) return res.status(404).json({ error: 'Not found' });

    const clientId = req.user.clientId || null;
    if (clientId && ad.client_id !== clientId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!clientId && ad.client_id) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    try {
      await deleteAdFile(ad.file_key);
    } catch (e) {
      logger.error('ads', 'Ad file delete error:', e);
    }
    await db.prepare('DELETE FROM advertisements WHERE id = ?').run(id);
    await log(req, 'ad.deleted', ad.name);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ads:updated');
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.put('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Статус должен быть: pending, approved, rejected' });
    }
    const ad = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
    if (!ad) return res.status(404).json({ error: 'Not found' });
    const clientId = req.user.clientId || null;
    if (clientId && ad.client_id !== clientId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    await db.pool.query('UPDATE advertisements SET status = $1 WHERE id = $2', [status, id]);
    await log(req, 'ad.status_changed', `${ad.name} → ${status}`);
    const { getIo } = require('../services/socketSetup');
    const io = getIo();
    if (io) io.emit('ads:updated');
    const updated = await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
