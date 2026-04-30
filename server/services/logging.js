const { db } = require('../database');

async function log(req, action, details = '') {
  const username = req.user?.username || 'visitor';
  const userId = req.user?.id || null;
  const clientId = req.user?.clientId || null;
  await db.prepare('INSERT INTO action_logs (user_id, username, action, details, client_id) VALUES (?,?,?,?,?)')
    .run(userId, username, action, details, clientId);
}

module.exports = { log };
