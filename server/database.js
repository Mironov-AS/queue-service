const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(DATA_DIR, 'queue.db'));

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

// ─── Indexes ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tickets_date ON tickets(date);
  CREATE INDEX IF NOT EXISTS idx_tickets_date_status ON tickets(date, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_service_id ON tickets(service_id);
  CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at DESC);
`);

// ─── Versioned Migrations ─────────────────────────────────────────────────────
// Each migration runs exactly once, tracked in schema_migrations table.
// Safe to run on every startup — already-applied migrations are skipped.

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const MIGRATIONS = [
  { version: 1,  name: 'add_services_description',       sql: `ALTER TABLE services ADD COLUMN description TEXT` },
  { version: 2,  name: 'add_services_priority',          sql: `ALTER TABLE services ADD COLUMN priority INTEGER DEFAULT 0` },
  { version: 3,  name: 'add_services_daily_limit',       sql: `ALTER TABLE services ADD COLUMN daily_limit INTEGER` },
  { version: 4,  name: 'add_services_enabled',           sql: `ALTER TABLE services ADD COLUMN enabled INTEGER DEFAULT 1` },
  { version: 5,  name: 'add_tickets_is_priority',        sql: `ALTER TABLE tickets ADD COLUMN is_priority INTEGER DEFAULT 0` },
  { version: 6,  name: 'add_tickets_name',               sql: `ALTER TABLE tickets ADD COLUMN name TEXT` },
  { version: 7,  name: 'add_tickets_phone',              sql: `ALTER TABLE tickets ADD COLUMN phone TEXT` },
  { version: 8,  name: 'add_tickets_skip_reason',        sql: `ALTER TABLE tickets ADD COLUMN skip_reason TEXT` },
  { version: 9,  name: 'add_tickets_cancel_reason',      sql: `ALTER TABLE tickets ADD COLUMN cancel_reason TEXT` },
  { version: 10, name: 'add_tickets_field_values',       sql: `ALTER TABLE tickets ADD COLUMN field_values TEXT` },
  { version: 11, name: 'add_services_is_default',        sql: `ALTER TABLE services ADD COLUMN is_default INTEGER DEFAULT 0` },
  { version: 12, name: 'add_users_must_change_password', sql: `ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0` },
  { version: 13, name: 'seed_remont_gbo_service',        sql: `INSERT INTO services (name, description, avg_duration_minutes, priority) SELECT 'Ремонт ГБО', 'Ремонт и обслуживание газобаллонного оборудования', 30, 0 WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Ремонт ГБО')` },
  { version: 14, name: 'seed_remont_gbo_nomer_avto',     sql: `INSERT INTO service_fields (service_id, label, field_type, required, order_index) SELECT s.id, 'Номер авто', 'text', 1, 0 FROM services s WHERE s.name = 'Ремонт ГБО' AND NOT EXISTS (SELECT 1 FROM service_fields sf WHERE sf.service_id = s.id AND sf.label = 'Номер авто')` },
  { version: 15, name: 'create_advertisements',          sql: `CREATE TABLE IF NOT EXISTS advertisements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, file_key TEXT NOT NULL, file_type TEXT NOT NULL, mime_type TEXT, duration INTEGER DEFAULT 15, order_index INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)` },
  { version: 16, name: 'seed_ad_ticket_display_time',    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES ('ad_ticket_display_time', '10')` },
  // ── Add new migrations here, incrementing version ──
];

const runMigrations = db.transaction(() => {
  for (const m of MIGRATIONS) {
    const already = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(m.version);
    if (already) continue;
    try {
      db.exec(m.sql);
    } catch (err) {
      // Column already exists in base schema (CREATE TABLE) — safe to skip
      if (!err.message.includes('duplicate column name')) throw err;
    }
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    console.log(`[db] migration v${m.version} applied: ${m.name}`);
  }
});

runMigrations();

const dbVersion = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
console.log(`[db] schema version: ${dbVersion.v ?? 0}`);

// ─── Seed ─────────────────────────────────────────────────────────────────────

// Default admin user
const adminExists = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123456', 10);
  db.prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES ('admin', ?, 'admin', 0)").run(hash);
} else if (adminExists.must_change_password) {
  // Admin never changed the default password — reset to new default and clear the flag
  const hash = bcrypt.hashSync('admin123456', 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, adminExists.id);
}

// Default services
const svcCount = db.prepare('SELECT COUNT(*) AS c FROM services').get();
if (svcCount.c === 0) {
  const ins = db.prepare('INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)');
  ins.run('Консультация', 'Общая консультация специалиста', 10, 0);
  ins.run('Оформление документов', 'Приём и оформление документов', 15, 0);
  ins.run('Оплата услуг', 'Оплата и кассовые операции', 5, 0);
  const gboInfo = ins.run('Ремонт ГБО', 'Ремонт и обслуживание газобаллонного оборудования', 30, 0);
  db.prepare('INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES (?, ?, ?, ?, ?)').run(gboInfo.lastInsertRowid, 'Номер авто', 'text', 1, 0);
}

// Default JWT secret
const jwtSetting = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get();
if (!jwtSetting) {
  const secret = require('crypto').randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
}

// Default registration open setting
const regSetting = db.prepare("SELECT value FROM settings WHERE key = 'registration_open'").get();
if (!regSetting) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('registration_open', '1')").run();
}

module.exports = db;
