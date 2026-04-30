const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config');

async function requireAuth(req, res, next) {
  const token = req.query.auth_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const secret = await getJwtSecret();
    const payload = jwt.verify(token, secret);
    req.user = {
      id: payload.userId || payload.id,
      username: payload.email || payload.username,
      role: payload.role,
      clientId: payload.clientId || null,
    };
    next();
  } catch(e) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

module.exports = { requireAuth };
