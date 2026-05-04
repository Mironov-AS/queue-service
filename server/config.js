const { db } = require('./database');

let _jwtSecret = null;

async function getJwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  const envSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (envSecret) {
    _jwtSecret = envSecret;
    return _jwtSecret;
  }
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret' AND client_id = ''").get();
  if (!row || !row.value) {
    throw new Error('JWT secret not configured: set JWT_ACCESS_SECRET or JWT_SECRET env var, or ensure jwt_secret exists in settings table');
  }
  _jwtSecret = row.value;
  return _jwtSecret;
}

module.exports = { getJwtSecret };
