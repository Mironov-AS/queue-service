const db = require('../database');

function log(req, action, details = '') {
  const username = req.user?.username || 'visitor';
  const userId = req.user?.id || null;
  db.prepare('INSERT INTO action_logs (user_id, username, action, details) VALUES (?,?,?,?)')
    .run(userId, username, action, details);
}

module.exports = { log };