// Модуль записи в основном сервере очереди: очередь на SQLite, запись на
// PostgreSQL. Тест проверяет, что запись включается только явными
// настройками и что при недоступной базе очередь продолжает работать.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const Database = require("better-sqlite3");
const {
	startBooking,
	setBookingState,
	getBookingState,
	notifyServicesChanged,
} = require("../services/bookingIntegration");
const { validateTestDatabaseUrl } = require("./test-database-guard");

const connectionString = process.env.BOOKING_TEST_DATABASE_URL;

function queueDb(rows) {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT, description TEXT, active INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1)",
	);
	const insert = db.prepare(
		"INSERT INTO services (id,name,description,active,enabled) VALUES (?,?,?,?,?)",
	);
	for (const r of rows) insert.run(...r);
	return db;
}

test("запись выключена без явных настроек", async () => {
	const db = queueDb([[1, "Ремонт ГБО", null, 1, 1]]);
	try {
		const state = await startBooking({ db, env: {} });
		assert.equal(state.enabled, false);
		assert.match(state.reason, /BOOKING_ENABLED/);
		const state2 = await startBooking({
			db,
			env: { BOOKING_ENABLED: "true" },
		});
		assert.equal(state2.enabled, false);
		assert.match(state2.reason, /BOOKING_DATABASE_URL/);
	} finally {
		db.close();
	}
});

test("запись выключена, если PostgreSQL недоступен", async () => {
	const db = queueDb([[1, "Ремонт ГБО", null, 1, 1]]);
	try {
		const state = await startBooking({
			db,
			env: {
				BOOKING_ENABLED: "true",
				BOOKING_DATABASE_URL:
					"postgresql://postgres@127.0.0.1:1/does_not_exist",
				BOOKING_CONNECT_TIMEOUT_MS: "1500",
			},
		});
		assert.equal(state.enabled, false);
		assert.ok(state.reason, "должна быть указана причина отключения");
	} finally {
		db.close();
	}
});

test("запись включается на PostgreSQL, справочник услуг синхронизируется", {
	skip: !connectionString,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(
		connectionString,
		process.env.BOOKING_TEST_ISOLATION_CONFIRMED,
	);
	const name = `booking_integration_${crypto.randomBytes(8).toString("hex")}`;
	const admin = new Pool({ connectionString, max: 1 });
	let pool;
	try {
		await admin.query(`CREATE SCHEMA "${name}"`);
		const db = queueDb([
			[1, "Ремонт ГБО", "описание", 1, 1],
			[2, "Диагностика подвески", null, 1, 0],
		]);
		const state = await startBooking({
			db,
			env: {
				BOOKING_ENABLED: "true",
				BOOKING_DATABASE_URL: connectionString,
				BOOKING_POOL_OPTIONS: `-c search_path=${name}`,
			},
		});
		assert.equal(state.enabled, true, state.reason || "");
		pool = state.pool;
		const services = await pool.query(
			"SELECT id,name,enabled FROM services ORDER BY id",
		);
		assert.equal(services.rows.length, 2);
		assert.equal(services.rows[0].name, "Ремонт ГБО");
		assert.equal(services.rows[1].enabled, 0);
		const tables = await pool.query(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
			[name],
		);
		const names = tables.rows.map((r) => r.table_name);
		assert.ok(names.includes("services"));
		assert.ok(names.includes("booking_config"));
		assert.ok(names.includes("bookings"));

		// Справочник услуг обновляется после изменений в очереди.
		db.prepare("UPDATE services SET name = ? WHERE id = 1").run(
			"Ремонт ГБО (новое)",
		);
		setBookingState(state);
		notifyServicesChanged();
		await new Promise((r) => setTimeout(r, 300));
		const updated = await pool.query("SELECT name FROM services WHERE id = 1");
		assert.equal(updated.rows[0].name, "Ремонт ГБО (новое)");
		db.close();
		await state.close();
	} finally {
		setBookingState(null);
		if (pool) await pool.end().catch(() => {});
		await admin
			.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
			.catch(() => {});
		await admin.end().catch(() => {});
	}
});
