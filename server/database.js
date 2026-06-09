const bcrypt = require("bcryptjs");
const createPgDb = require("../../../shared/db");
const log = require("./services/logger");

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
      owner_id TEXT,
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
  `);

	// Migration 100: per-client isolation for settings and advertisements
	const migV100 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 100")
		.get();
	if (!migV100) {
		try {
			await db.exec(
				"ALTER TABLE settings ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT ''",
			);
			await db.exec(
				"ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey",
			);
			await db.exec(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_client ON settings(key, client_id)",
			);
			await db.exec(
				"ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT NULL",
			);
			await db.exec(
				"CREATE INDEX IF NOT EXISTS idx_ads_client_id ON advertisements(client_id)",
			);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (100, 'per_client_isolation') ON CONFLICT DO NOTHING",
			);
			log.info("db", "Migration 100: per-client isolation applied");
		} catch (e) {
			log.warn("db", "Migration 100 warning:", e.message);
		}
	}

	// Migration 101: change owner_id from INTEGER to TEXT for UUID compatibility
	const migV101 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 101")
		.get();
	if (!migV101) {
		try {
			await db.exec(
				"ALTER TABLE advertisements ALTER COLUMN owner_id TYPE TEXT USING owner_id::TEXT",
			);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (101, 'owner_id_to_text') ON CONFLICT DO NOTHING",
			);
			log.info("db", "Migration 101: owner_id changed to TEXT");
		} catch (e) {
			log.warn("db", "Migration 101 warning:", e.message);
		}
	}

	// Migration 103: add password_hash to users table if missing
	const migV103 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 103")
		.get();
	if (!migV103) {
		try {
			await db.exec(
				"ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''",
			);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (103, 'users_password_hash') ON CONFLICT DO NOTHING",
			);
			log.info("db", "Migration 103: password_hash column added to users");
		} catch (e) {
			log.warn("db", "Migration 103 warning:", e.message);
		}
	}

	// Migration 104: add role and must_change_password to users table if missing
	const migV104 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 104")
		.get();
	if (!migV104) {
		try {
			await db.exec(
				"ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'operator'",
			);
			await db.exec(
				"ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER DEFAULT 0",
			);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (104, 'users_role_columns') ON CONFLICT DO NOTHING",
			);
			log.info(
				"db",
				"Migration 104: role and must_change_password added to users",
			);
		} catch (e) {
			log.warn("db", "Migration 104 warning:", e.message);
		}
	}

	// Migration 105: add is_premium to users table (BOOLEAN, not INTEGER)
	const migV105 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 105")
		.get();
	if (!migV105) {
		try {
			// Check current column type
			const colInfo = await db.pool.query(
				"SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_premium'",
			);
			if (colInfo.rows.length === 0) {
				await db.exec(
					"ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT false NOT NULL",
				);
			} else if (colInfo.rows[0].data_type !== "boolean") {
				// Fix existing INTEGER column to BOOLEAN
				await db.exec("ALTER TABLE users DROP COLUMN IF EXISTS is_premium");
				await db.exec(
					"ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT false NOT NULL",
				);
			}
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (105, 'users_is_premium_bool') ON CONFLICT DO NOTHING",
			);
			log.info(
				"db",
				"Migration 105: is_premium BOOLEAN column applied to users",
			);
		} catch (e) {
			log.warn("db", "Migration 105 warning:", e.message);
		}
	}

	// Seed default admin user (skip if table already exists with different schema)
	try {
		const adminExists = await db
			.prepare("SELECT * FROM users WHERE username = 'admin'")
			.get();
		if (!adminExists) {
			const hash = bcrypt.hashSync("admin123456", 10);
			await db.pool.query(
				"INSERT INTO users (username, password_hash, role, must_change_password, is_premium) VALUES ($1, $2, 'admin', 0, true)",
				["admin", hash],
			);
		}
	} catch (e) {
		log.warn("db", "User seed skipped (table may not exist yet):", e.message);
	}

	// Default services
	const svcCount = await db.prepare("SELECT COUNT(*) AS c FROM services").get();
	if (parseInt(svcCount.c) === 0) {
		await db
			.prepare(
				"INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)",
			)
			.run("Консультация", "Общая консультация специалиста", 10, 0);
		await db
			.prepare(
				"INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)",
			)
			.run("Оформление документов", "Приём и оформление документов", 15, 0);
		await db
			.prepare(
				"INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES (?, ?, ?, ?)",
			)
			.run("Оплата услуг", "Оплата и кассовые операции", 5, 0);
		const { rows } = await db.pool.query(
			"INSERT INTO services (name, description, avg_duration_minutes, priority) VALUES ($1, $2, $3, $4) RETURNING id",
			[
				"Ремонт ГБО",
				"Ремонт и обслуживание газобаллонного оборудования",
				30,
				0,
			],
		);
		if (rows[0]) {
			await db
				.prepare(
					"INSERT INTO service_fields (service_id, label, field_type, required, order_index) VALUES (?, ?, ?, ?, ?)",
				)
				.run(rows[0].id, "Номер авто", "text", 1, 0);
		}
	}

	// Default JWT secret (global, client_id='')
	const jwtSetting = await db
		.prepare(
			"SELECT value FROM settings WHERE key = 'jwt_secret' AND client_id = ''",
		)
		.get();
	if (!jwtSetting) {
		const secret = require("crypto").randomBytes(32).toString("hex");
		await db.pool.query(
			"INSERT INTO settings (key, value, client_id) VALUES ('jwt_secret', $1, '') ON CONFLICT(key, client_id) DO NOTHING",
			[secret],
		);
	}

	// Default registration open setting (global default)
	const regSetting = await db
		.prepare(
			"SELECT value FROM settings WHERE key = 'registration_open' AND client_id = ''",
		)
		.get();
	if (!regSetting) {
		await db.pool.query(
			"INSERT INTO settings (key, value, client_id) VALUES ('registration_open', '1', '') ON CONFLICT(key, client_id) DO NOTHING",
		);
	}

	// Default ad settings (global defaults)
	const adDefaults = {
		ad_ticket_display_time: "10",
		ad_dashboard_interval: "0",
		ad_ads_before_dashboard: "0",
	};
	for (const [key, def] of Object.entries(adDefaults)) {
		const existing = await db
			.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ''")
			.get(key);
		if (!existing) {
			await db.pool.query(
				"INSERT INTO settings (key, value, client_id) VALUES ($1, $2, '') ON CONFLICT(key, client_id) DO NOTHING",
				[key, def],
			);
		}
	}

	// Migration 102: add window_number column to tickets
	const migV102 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 102")
		.get();
	if (!migV102) {
		try {
			await db.exec(
				"ALTER TABLE tickets ADD COLUMN IF NOT EXISTS window_number INTEGER DEFAULT NULL",
			);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (102, 'ticket_window_number') ON CONFLICT DO NOTHING",
			);
			log.info("db", "Migration 102: window_number column added to tickets");
		} catch (e) {
			log.warn("db", "Migration 102 warning:", e.message);
		}
	}

	// Migration 106: logo_blobs table (PostgreSQL BYTEA for persistent logo storage)
	const migV106 = await db
		.prepare("SELECT version FROM schema_migrations WHERE version = 106")
		.get();
	if (!migV106) {
		try {
			await db.exec(`
				CREATE TABLE IF NOT EXISTS logo_blobs (
					key TEXT PRIMARY KEY,
					data BYTEA NOT NULL,
					mime_type TEXT NOT NULL DEFAULT 'image/png',
					created_at TIMESTAMPTZ DEFAULT NOW()
				)
			`);
			await db.pool.query(
				"INSERT INTO schema_migrations (version, name) VALUES (106, 'logo_blobs_table') ON CONFLICT DO NOTHING",
			);
			log.info("db", "Migration 106: logo_blobs table created");
		} catch (e) {
			log.warn("db", "Migration 106 warning:", e.message);
		}
	}

	log.info("db", "PostgreSQL schema initialized");
}

async function getClientSetting(key, clientId, defaultValue = null) {
	if (clientId) {
		const row = await db
			.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ?")
			.get(key, clientId);
		if (row) return row.value;
	}
	const globalRow = await db
		.prepare("SELECT value FROM settings WHERE key = ? AND client_id = ''")
		.get(key);
	return globalRow?.value ?? defaultValue;
}

async function setClientSetting(key, value, clientId) {
	const cid = clientId || "";
	await db.pool.query(
		"INSERT INTO settings (key, value, client_id) VALUES ($1, $2, $3) ON CONFLICT(key, client_id) DO UPDATE SET value = EXCLUDED.value",
		[key, String(value), cid],
	);
}

// ── Logo blob helpers (PostgreSQL BYTEA) ───────────────────────────────────

/**
 * saveLogoData — stores binary logo in logo_blobs BYTEA table.
 * Upsert: replaces existing blob for the same key.
 * @param {string} key   logo key (filename)
 * @param {Buffer} buffer  raw image bytes
 * @param {string} mimetype
 */
async function saveLogoData(key, buffer, mimetype) {
	await db.pool.query(
		`INSERT INTO logo_blobs (key, data, mime_type)
		 VALUES ($1, $2, $3)
		 ON CONFLICT(key) DO UPDATE
		 SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type, created_at = NOW()`,
		[key, buffer, mimetype || "image/png"],
	);
}

/**
 * getLogoData — retrieves logo blob from logo_blobs.
 * @param {string} key
 * @returns {{ buffer: Buffer, mimetype: string } | null}
 */
async function getLogoData(key) {
	if (!key) return null;
	const row = await db
		.prepare("SELECT data, mime_type FROM logo_blobs WHERE key = ?")
		.get(key);
	if (!row) return null;
	// pg returns Buffer already — wrap if needed
	const buffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
	return { buffer, mimetype: row.mime_type || "image/png" };
}

/**
 * deleteLogoData — removes logo blob from logo_blobs.
 * @param {string} key
 */
async function deleteLogoData(key) {
	if (!key) return;
	await db.prepare("DELETE FROM logo_blobs WHERE key = ?").run(key);
}

function getDb() {
	return db;
}

module.exports = {
	db,
	initDb,
	getClientSetting,
	setClientSetting,
	saveLogoData,
	getLogoData,
	deleteLogoData,
	getDb,
};
