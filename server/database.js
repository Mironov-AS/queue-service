const bcrypt = require('bcryptjs');
const createPgDb = require('../../../shared/db');

const db = createPgDb(process.env.DATABASE_URL);

async function initDb() {
  await db.ensureSchema();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      avg_duration_minutes INTEGER DEFAULT 5,
      priority INTEGER DEFAULT 0,
      daily_limit INTEGER,
      active INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      client_id TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      number INTEGER NOT NULL,
      date TEXT NOT NULL,
      service_id INTEGER REFERENCES services(id),
      status TEXT DEFAULT 'waiting',
      is_priority INTEGER DEFAULT 0,
      name TEXT,
      phone TEXT,
      field_values TEXT,
      skip_reason TEXT,
      cancel_reason TEXT,
      client_id TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      called_at TIMESTAMPTZ,
      served_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'operator',
      must_change_password INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS action_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      client_id TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      value TEXT,
      client_id TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS service_fields (
      id SERIAL PRIMARY KEY,
      service_id INTEGER REFERENCES services(id),
      label TEXT NOT NULL,
      field_type TEXT DEFAULT 'text',
      required INTEGER DEFAULT 0,
      order_index INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS advertisements (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      file_key TEXT NOT NULL,
      file_type TEXT NOT NULL,
      mime_type TEXT,
      duration INTEGER DEFAULT 15,
      order_index INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      owner_id INTEGER,
      owner_username TEXT,
      status TEXT DEFAULT 'approved',
      client_id TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_date ON tickets(date);
    CREATE INDEX IF NOT EXISTS idx_tickets_date_status ON tickets(date, status);
    CREATE INDEX IF NOT EXISTS idx_tickets_service_id ON tickets(service_id);
    CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_services_client_id ON services(client_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_client_id ON tickets(client_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_date_client ON tickets(date, client_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_client ON settings(key, client_id);
    CREATE INDEX IF NOT EXISTS idx_ads_client_id ON advertisements(client_id);
  `);

  // Migration 100: per-client isolation for settings and advertisements
  const migV100 = await db.prepare("SELECT version FROM schema_migrations WHERE version = 100").get();
  if (!migV100) {
    try {
      await db.exec("ALTER TABLE settings ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT ''");
      await db.exec("ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey");
      await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_client ON settings(key, client_id)");
      await db.exec("ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT NULL");
      await db.exec("CREATE INDEX IF NOT EXISTS idx_ads_client_id ON advertisements(client_id)");
      await db.pool.query("INSERT INTO schema_migrations (version, name) VALUES (100, 'per_client_isolation') ON CONFLICT DO NOTHING");
      console.log('[db] Migration 100: per-client isolation applied');
    } catch (e) {
      console.warn('[db] Migration 100 warning:', e.message);
    }
  }

  // Seed default admin user
  const adminExists = await db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123456', 10);
    await db.prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES ('admin', ?, 'admin', 0)").run(hash);
  }

  // Default services
  const svcCount = await db.prepare('SELECT COUNT(*) AS c FROM services').get();
  if (parseInt(svcCount.c) === 0) {
    await db.prepare('INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)').run('Консультация', 'Общая консультация специалиста', 10, 0);
    await db.prepare('INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)').run('Оформление документов', 'Приём и оформление документов', 15, 0);
    await db.prepare('INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)').run('Оплата услуг', 'Оплата и кассовые операции', 5, 0);
    const { rows } = await db.pool.query("INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES ($1, $2, $3, $4) RETURNING id", ['Ремонт ГБО', 'Ремонт и обслуживание газобаллонного оборудования', 30, 0]);
    if (rows[0]) {
      await db.prepare('INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES (?, ?, ?, ?, ?)').run(rows[0].id, 'Номер авто', 'text', 1, 0);
    }
  }

  // Default JWT secret (global, client_id='')
  const jwtSetting = await db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret' AND client_id = ''").get();
  if (!jwtSetting) {
    const secret = require('crypto').randomBytes(32).toString('hex');
    await db.pool.query("INSERT INTO settings (key, value, client_id) VALUES ('jwt_secret', $1, '') ON CONFLICT(key, client_id) DO NOTHING", [secret]);
  }

  // Default registration open setting (global default)
  const regSetting = await db.prepare("SELECT value FROM settings WHERE key = 'registration_open' AND client_id = ''").get();
  if (!regSetting) {
    await db.pool.query("INSERT INTO settings (key, value, client_id) VALUES ('registration_open', '1', '') ON CONFLICT(key, client_id) DO NOTHING");
  }

  // Default ad settings (global defaults)
  const adDefaults = { ad_ticket_display_time: '10', ad_dashboard_interval: '0', ad_ads_before_dashboard: '0' };
  for (const [key, def] of Object.entries(adDefaults)) {
    const existing = await db.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ''").get(key);
    if (!existing) {
      await db.pool.query("INSERT INTO settings (key, value, client_id) VALUES ($1, $2, '') ON CONFLICT(key, client_id) DO NOTHING", [key, def]);
    }
  }

  console.log('[db] PostgreSQL schema initialized');
}

async function getClientSetting(key, clientId, defaultValue = null) {
  if (clientId) {
    const row = await db.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ?").get(key, clientId);
    if (row) return row.value;
  }
  const globalRow = await db.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ''").get(key);
  return globalRow?.value ?? defaultValue;
}

async function setClientSetting(key, value, clientId) {
  const cid = clientId || '';
  await db.pool.query(
    "INSERT INTO settings (key, value, client_id) VALUES ($1, $2, $3) ON CONFLICT(key, client_id) DO UPDATE SET value = EXCLUDED.value",
    [key, String(value), cid]
  );
}

module.exports = { db, initDb, getClientSetting, setClientSetting };
