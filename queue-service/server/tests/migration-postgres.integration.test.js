const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { expected } = require("../migration/schema-audit");
const {
	schema: bookingSchema,
	bookingRepository,
} = require("../services/bookingRepository");
const { validateTestDatabaseUrl } = require("./test-database-guard");
const url = process.env.BOOKING_TEST_DATABASE_URL;

test("PostgreSQL: схема очереди, связи, последовательности и модуль записи", {
	skip: !url,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(url, process.env.BOOKING_TEST_ISOLATION_CONFIRMED);
	const name = `queue_schema_${crypto.randomBytes(12).toString("hex")}`;
	const admin = new Pool({
		connectionString: url,
		max: 1,
		connectionTimeoutMillis: 5000,
	});
	let pool,
		created = false;
	try {
		await admin.query(`CREATE SCHEMA "${name}"`);
		created = true;
		pool = new Pool({
			connectionString: url,
			max: 3,
			options: `-c search_path=${name}`,
			connectionTimeoutMillis: 5000,
		});
		await pool.query(
			fs.readFileSync(
				path.join(__dirname, "../migration/queue-schema.sql"),
				"utf8",
			),
		);
		for (const [table, columns] of Object.entries(expected)) {
			const r = await pool.query(
				"SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
				[name, table],
			);
			assert.deepEqual(
				r.rows.map((x) => x.column_name),
				columns,
				table,
			);
		}
		await pool.query("INSERT INTO services(id,name) VALUES(50,'Услуга')");
		await pool.query(
			"INSERT INTO tickets(id,number,date,service_id) VALUES(100,7,'2026-10-30',50)",
		);
		await pool.query(
			"SELECT setval(pg_get_serial_sequence('services','id'),COALESCE((SELECT max(id) FROM services),1), EXISTS(SELECT 1 FROM services))",
		);
		await pool.query(
			"SELECT setval(pg_get_serial_sequence('tickets','id'),COALESCE((SELECT max(id) FROM tickets),1), EXISTS(SELECT 1 FROM tickets))",
		);
		assert.equal(
			(
				await pool.query(
					"INSERT INTO services(name) VALUES('Новая') RETURNING id",
				)
			).rows[0].id,
			51,
		);
		assert.equal(
			(
				await pool.query(
					"INSERT INTO tickets(number,date,service_id) VALUES(8,'2026-10-30',50) RETURNING id",
				)
			).rows[0].id,
			101,
		);
		await assert.rejects(
			pool.query(
				"INSERT INTO tickets(number,date,service_id) VALUES(9,'2026-10-30',9999)",
			),
			(e) => e.code === "23503",
		);
		await pool.query(bookingSchema);
		const repo = bookingRepository(pool);
		const config = await repo.saveConfig(50, {
			enabled: true,
			duration_minutes: 30,
			capacity: 1,
			schedule: [{ day: 1, start: "09:00", end: "10:00" }],
			exceptions: [],
			fields: [],
			timezone: "Europe/Moscow",
		});
		assert.ok(config.public_id);
	} finally {
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${name}" CASCADE`);
		await admin.end();
	}
});
