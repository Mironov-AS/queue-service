// Explicit opt-in only: this test creates and drops its own randomly named schema.
// Never point TEST_DATABASE_URL to production or a database containing sensitive data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { bookingRepository, schema } = require("../services/bookingRepository");
const connectionString = process.env.BOOKING_TEST_DATABASE_URL;

test("PostgreSQL: конкурентная запись, отключение, повторное включение и отмена", {
	skip: !connectionString,
	timeout: 30000,
}, async () => {
	const name = `booking_test_${crypto.randomBytes(12).toString("hex")}`;
	const admin = new Pool({
		connectionString,
		max: 1,
		connectionTimeoutMillis: 5000,
	});
	let pool;
	let created = false;
	try {
		await admin.query(`CREATE SCHEMA "${name}"`);
		created = true;
		pool = new Pool({
			connectionString,
			max: 8,
			options: `-c search_path=${name}`,
			connectionTimeoutMillis: 5000,
		});
		await pool.query(
			"CREATE TABLE services(id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1)",
		);
		await pool.query(schema);
		await pool.query(
			"INSERT INTO services(id,name,active) VALUES(1,'Тестовая услуга',1)",
		);
		const repo = bookingRepository(pool);
		const day = "2099-11-02";
		const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
		const config = {
			enabled: true,
			duration_minutes: 30,
			capacity: 1,
			schedule: [{ day: weekday, start: "09:00", end: "10:00" }],
			exceptions: [],
			fields: [
				{ id: "phone", label: "Телефон", type: "phone", required: true },
			],
			timezone: "Europe/Moscow",
		};
		const initial = await repo.saveConfig(1, config);
		const consent = { version: "test-v1", text: "Тестовое согласие" };
		const request = {
			date: day,
			start: "09:00",
			answers: { phone: "тест" },
			consent: true,
		};
		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, () =>
				repo.create(initial.public_id, request, consent),
			),
		);
		assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
		assert.equal(
			attempts.filter(
				(x) =>
					x.status === "rejected" && /Время недоступно/.test(x.reason.message),
			).length,
			7,
		);
		const rows = await pool.query(
			"SELECT consent_version,consent_text,consented_at,answers FROM bookings",
		);
		assert.equal(rows.rowCount, 1);
		assert.equal(rows.rows[0].consent_version, "test-v1");
		assert.equal(rows.rows[0].consent_text, consent.text);
		assert.ok(rows.rows[0].consented_at);
		assert.equal(rows.rows[0].answers.phone.value, "тест");
		const disabled = await repo.saveConfig(1, { ...config, enabled: false });
		assert.equal(disabled.public_id, initial.public_id);
		assert.equal(await repo.getPublic(initial.public_id, day), null);
		const enabled = await repo.saveConfig(1, config);
		assert.equal(enabled.public_id, initial.public_id);
		assert.equal(
			(await repo.getPublic(initial.public_id, day)).slots[0].available,
			0,
		);
		const calendar = await repo.getCalendar(1, day);
		assert.equal(calendar.bookings.length, 1);
		assert.equal(await repo.cancel(1, calendar.bookings[0].id), true);
		assert.equal(
			(await repo.getPublic(initial.public_id, day)).slots[0].available,
			1,
		);
	} finally {
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${name}" CASCADE`);
		await admin.end();
	}
});
