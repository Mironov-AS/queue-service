const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { getAdUrl, deleteAdFile, saveAdFile, makeAdKey, UPLOADS_DIR } = require('../services/storage');
const { log } = require('../services/logging');

const router = express.Router();

// ── Chunk upload setup ─────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(UPLOADS_DIR, 'chunks');
fs.mkdirSync(CHUNK_DIR, { recursive: true });

// Clean up abandoned chunk sessions older than 2 hours
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
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB per chunk max
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
      console.error(`[ads] Failed to get URL for ad ${ad.id}:`, err.message);
      return { ...ad, url: null };
    }
  }));
}

// GET /api/ads — public, approved active ads only
router.get('/', async (req, res) => {
  const ads = db.prepare("SELECT * FROM advertisements WHERE active = 1 AND (status IS NULL OR status = 'approved') ORDER BY order_index ASC, id ASC").all();
  res.json(await enrichAds(ads));
});

// POST /api/ads/chunk — upload one chunk of a large file
// Each chunk must be ≤ 2MB; server assembles after all chunks received.
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

    // Sanitize uploadId to prevent path traversal
    const safeId = uploadId.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    if (!safeId) return res.status(400).json({ error: 'Некорректный uploadId' });

    const sessionDir = path.join(CHUNK_DIR, safeId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Save chunk to disk
    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    fs.writeFileSync(chunkPath, req.file.buffer);

    // Check if all chunks have arrived
    const receivedChunks = fs.readdirSync(sessionDir).filter(f => f.startsWith('chunk_')).length;
    if (receivedChunks < totalChunks) {
      return res.json({ done: false, received: receivedChunks, total: totalChunks });
    }

    // All chunks received — assemble the file
    try {
      const parts = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = path.join(sessionDir, `chunk_${i}`);
        parts.push(fs.readFileSync(p));
      }
      const buffer = Buffer.concat(parts);

      // Clean up chunk directory
      fs.rmSync(sessionDir, { recursive: true, force: true });

      const ext = (originalName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = makeAdKey(ext, mimeType);
      const fileType = mimeType.startsWith('video/') ? 'video' : 'image';

      await saveAdFile(key, buffer, mimeType, originalName);

      const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements').get();
      const adStatus = req.user.role === 'admin' ? 'approved' : 'pending';
      const r = db.prepare(
        'INSERT INTO advertisements (name, file_key, file_type, mime_type, duration, order_index, owner_id, owner_username, status) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(name.trim(), key, fileType, mimeType, parseInt(duration, 10) || 15, maxOrder.m + 1, req.user.id, req.user.username, adStatus);

      const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(r.lastInsertRowid);
      const url = await getAdUrl(key);
      log(req, 'ad.created', name.trim());
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.emit('ads:updated');

      return res.json({ done: true, ad: { ...ad, url } });
    } catch (e) {
      console.error('Chunk assembly error:', e);
      return res.status(500).json({ error: 'Ошибка сборки файла: ' + e.message });
    }
  });
});

// GET /api/ads/all — admin sees all, others see only own
router.get('/all', requireAuth, async (req, res) => {
  let ads;
  if (req.user.role === 'admin') {
    ads = db.prepare('SELECT * FROM advertisements ORDER BY order_index ASC, id ASC').all();
  } else {
    ads = db.prepare('SELECT * FROM advertisements WHERE owner_id = ? ORDER BY order_index ASC, id ASC').all(req.user.id);
  }
  res.json(await enrichAds(ads));
});

// POST /api/ads — upload new ad
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

      const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM advertisements').get();
      const adStatus = req.user.role === 'admin' ? 'approved' : 'pending';
      const r = db.prepare(
        'INSERT INTO advertisements (name, file_key, file_type, mime_type, duration, order_index, owner_id, owner_username, status) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(name.trim(), key, fileType, req.file.mimetype, parseInt(duration, 10) || 15, maxOrder.m + 1, req.user.id, req.user.username, adStatus);

      const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(r.lastInsertRowid);
      const url = await getAdUrl(key);
      log(req, 'ad.created', name.trim());
      const { getIo } = require('../services/socketSetup');
      const io = getIo();
      if (io) io.emit('ads:updated');
      res.json({ ...ad, url });
    } catch (e) {
      console.error('Ad upload error:', e);
      res.status(500).json({ error: 'Ошибка загрузки: ' + e.message });
    }
  });
});

// PUT /api/ads/:id — update ad metadata
router.put('/:id', requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
  if (!ad) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && ad.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  const { name, duration, active, order_index } = req.body;
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
  const { getIo } = require('../services/socketSetup');
  const io = getIo();
  if (io) io.emit('ads:updated');
  res.json(db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id));
});

// DELETE /api/ads/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Некорректный id' });
  const ad = db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id);
  if (!ad) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && ad.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Нет доступа' });
  }

  try {
    await deleteAdFile(ad.file_key);
  } catch (e) {
    console.error('Ad file delete error:', e);
  }
  db.prepare('DELETE FROM advertisements WHERE id = ?').run(id);
  log(req, 'ad.deleted', ad.name);
  const { getIo } = require('../services/socketSetup');
  const io = getIo();
  if (io) io.emit('ads:updated');
  res.json({ success: true });
});

// PUT /api/ads/:id/status — admin only
router.put('/:id/status', requireAuth, requireAdmin, (req, res) => {
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
  const { getIo } = require('../services/socketSetup');
  const io = getIo();
  if (io) io.emit('ads:updated');
  res.json(db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id));
});

module.exports = router;