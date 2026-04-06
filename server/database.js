const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'queue.db'));

db.pragma('journal_mode = WAL');

// ─── Base schema ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    avg_duration_minutes INTEGER DEFAULT 5,
    priority INTEGER DEFAULT 0,
    daily_limit INTEGER,
    active INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    date TEXT NOT NULL,
    service_id INTEGER REFERENCES services(id),
    status TEXT DEFAULT 'waiting',
    is_priority INTEGER DEFAULT 0,
    name TEXT,
    phone TEXT,
    skip_reason TEXT,
    cancel_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    called_at DATETIME,
    served_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'operator',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS service_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER REFERENCES services(id),
    label TEXT NOT NULL,
    field_type TEXT DEFAULT 'text',
    required INTEGER DEFAULT 0,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Migrations (safe) ────────────────────────────────────────────────────────

function addCol(table, col, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (_) {}
}

addCol('services', 'description', 'TEXT');
addCol('services', 'priority', 'INTEGER DEFAULT 0');
addCol('services', 'daily_limit', 'INTEGER');
addCol('services', 'enabled', 'INTEGER DEFAULT 1');
addCol('tickets', 'is_priority', 'INTEGER DEFAULT 0');
addCol('tickets', 'name', 'TEXT');
addCol('tickets', 'phone', 'TEXT');
addCol('tickets', 'skip_reason', 'TEXT');
addCol('tickets', 'cancel_reason', 'TEXT');
addCol('tickets', 'field_values', 'TEXT');

// ─── Seed ─────────────────────────────────────────────────────────────────────

// Default admin user
const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')").run(hash);
}

// Default services
const svcCount = db.prepare('SELECT COUNT(*) AS c FROM services').get();
if (svcCount.c === 0) {
  const ins = db.prepare('INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)');
  ins.run('Консультация', 'Общая консультация специалиста', 10, 0);
  ins.run('Оформление документов', 'Приём и оформление документов', 15, 0);
  ins.run('Оплата услуг', 'Оплата и кассовые операции', 5, 0);
}

// Default JWT secret
const jwtSetting = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
if (!jwtSetting) {
  const secret = require('crypto').randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
}

module.exports = db;
