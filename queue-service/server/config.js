const db = require('./database');

let _jwtSecret = null;

function getJwtSecret() {
  if (_jwtSecret) return _jwtSecret;
  _jwtSecret = process.env.JWT_SECRET || db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get().value;
  return _jwtSecret;
}

module.exports = { getJwtSecret };