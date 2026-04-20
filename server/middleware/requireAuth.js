const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config');

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

module.exports = { requireAuth };