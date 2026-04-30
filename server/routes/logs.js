const express = require('express');
const { db } = require('../database');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = clampInt(req.query.limit, 1, 1000, 100);
    const rows = await db.prepare(
      'SELECT * FROM action_logs ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
