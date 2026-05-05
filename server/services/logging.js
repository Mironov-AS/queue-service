const { db } = require('../database');
const logger = require('./logger');

function normalizeNumericId(id) {
  if (id === null || id === undefined || id === '') return null;
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

async function log(req, action, details = '') {
  const username = req.user?.username || 'visitor';
  const userId = normalizeNumericId(req.user?.id);
  const clientId = req.user?.clientId || null;
  try {
    await db.prepare('INSERT INTO action_logs (user_id, username, action, details, client_id) VALUES (?,?,?,?,?)')
      .run(userId, username, action, details, clientId);
  } catch (err) {
    logger.warn('logging', 'failed to write action log:', err.message);
  }
}

module.exports = { log };
