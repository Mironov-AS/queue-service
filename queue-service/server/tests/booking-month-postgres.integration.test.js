// Explicit opt-in only: this test creates and drops its own randomly named schema.
// Never point BOOKING_TEST_DATABASE_URL to production or a database containing sensitive data.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { bookingRepository, schema } = require("../services/bookingRepository");
const connectionString = process.env.BOOKING_TEST_DATABASE_URL;
const { validateTestDatabaseUrl } = require("./test-database-guard");

test("PostgreSQL: календарь месяца отмечает закрытые, занятые и прошедшие дни", {
	skip: !connectionString,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(
		connectionString,
		process.env.BOOKING_TEST_ISOLATION_CONFIRMED,
	);
	const name = `booking_month_${crypto.randomBytes(12).toString("hex")}`;
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
		// A month far in the future keeps the test independent of the clock.
		const month = "2099-11";
		const busyDay = "2099-11-02";
		const freeDay = "2099-11-09";
		const weekday = new Date(`${busyDay}T00:00:00Z`).getUTCDay();
		const config = {
			enabled: true,
			duration_minutes: 60,
			capacity: 1,
			schedule: [{ day: weekday, start: "09:00", end: "10:00" }],
			exceptions: [],
			fields: [],
			timezone: "Europe/Moscow",
		};
		const saved = await repo.saveConfig(1, config);
		const consent = { version: "test-v1", text: "Тестовое согласие" };
		await repo.create(
			saved.public_id,
			{ date: busyDay, start: "09:00", answers: {}, consent: true },
			consent,
		);
		const month1 = await repo.getAvailability(saved.public_id, month);
		assert.equal(month1.month, month);
		assert.equal(month1.timezone, "Europe/Moscow");
		assert.equal(month1.days.length, 30);
		const byDate = Object.fromEntries(month1.days.map((d) => [d.date, d]));
		assert.equal(byDate[busyDay].available, false);
		assert.equal(byDate[busyDay].reason, "full");
		assert.equal(byDate[busyDay].free, 0);
		assert.equal(byDate[freeDay].available, true);
		assert.ok(byDate[freeDay].free > 0);
		// Sunday is not a working day in this schedule.
		assert.equal(byDate["2099-11-07"].available, false);
		assert.equal(byDate["2099-11-07"].reason, "closed");
		// A month in the past is entirely unavailable.
		const past = await repo.getAvailability(saved.public_id, "2020-11");
		assert.ok(past.days.every((d) => d.reason === "past"));
		assert.ok(past.days.every((d) => d.available === false));
		// The default month is the current one in the service time zone.
		const current = await repo.getAvailability(saved.public_id);
		assert.match(current.month, /^\d{4}-\d{2}$/);
		// Public calendar data carries no client fields.
		assert.equal(JSON.stringify(month1).includes("consent_text"), false);
		// The administrative overview counts slots and bookings per day.
		const adminMonth = await repo.getAdminMonth(1, month);
		assert.equal(adminMonth.month, month);
		assert.equal(adminMonth.days.length, 30);
		const adminByDate = Object.fromEntries(
			adminMonth.days.map((d) => [d.date, d]),
		);
		assert.equal(adminByDate[busyDay].booked, 1);
		assert.equal(adminByDate[busyDay].free, 0);
		assert.equal(adminByDate[freeDay].booked, 0);
		assert.ok(adminByDate[freeDay].free > 0);
		assert.equal(adminByDate[freeDay].slots, 1);
		// The overview carries counters, never client data.
		assert.equal(JSON.stringify(adminMonth).includes("answers"), false);
		// The channel state lists every service with its booking channel.
		const channels = await repo.getServiceChannels();
		const channel = channels.find((c) => c.id === 1);
		assert.equal(channel.booking_enabled, true);
		assert.equal(channel.public_id, saved.public_id);
		assert.equal(channel.name, "Тестовая услуга");
		// A service without a booking configuration is reported as disabled.
		await pool.query(
			"INSERT INTO services(id,name,active) VALUES(3,'Только очередь',1)",
		);
		const after = await repo.getServiceChannels();
		const queueOnly = after.find((c) => c.id === 3);
		assert.equal(queueOnly.booking_enabled, false);
		assert.equal(queueOnly.public_id, null);
		// The administrator list of the month contains the client data.
		const adminBookings = await repo.getAdminBookings(1, month);
		assert.equal(adminBookings.month, month);
		assert.equal(adminBookings.bookings.length, 1);
		assert.equal(adminBookings.bookings[0].date, busyDay);
		assert.equal(adminBookings.bookings[0].start, "09:00");
		assert.equal(adminBookings.bookings[0].end, "10:00");
		assert.ok(adminBookings.bookings[0].answers);
		// Bookings of other months are not included.
		const otherMonth = await repo.getAdminBookings(1, "2099-12");
		assert.equal(otherMonth.bookings.length, 0);
	} finally {
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${name}" CASCADE`);
		await admin.end();
	}
});
