const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
	createPostgresQueueActions,
} = require("../services/postgresQueueActions");
const { validateTestDatabaseUrl } = require("./test-database-guard");
const url = process.env.BOOKING_TEST_DATABASE_URL;
test("PostgreSQL: вызов следующего и конкретного талона при одновременных запросах", {
	skip: !url,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(url, process.env.BOOKING_TEST_ISOLATION_CONFIRMED);
	const schema = `queue_actions_${crypto.randomBytes(12).toString("hex")}`;
	const admin = new Pool({
		connectionString: url,
		max: 1,
		connectionTimeoutMillis: 5000,
	});
	let pool,
		created = false;
	try {
		await admin.query(`CREATE SCHEMA "${schema}"`);
		created = true;
		pool = new Pool({
			connectionString: url,
			max: 4,
			options: `-c search_path=${schema}`,
			connectionTimeoutMillis: 5000,
		});
		await pool.query(
			fs.readFileSync(
				path.join(__dirname, "../migration/queue-schema.sql"),
				"utf8",
			),
		);
		await pool.query("INSERT INTO services(id,name) VALUES(1,'Услуга')");
		await pool.query(`INSERT INTO tickets(id,number,date,service_id,status,is_priority,created_at) VALUES
  (1,1,'2099-01-01',1,'called',0,'2099-01-01 08:00:00'),
  (2,2,'2099-01-01',1,'waiting',0,'2099-01-01 09:00:00'),
  (3,3,'2099-01-01',1,'waiting',1,'2099-01-01 10:00:00')`);
		const queue = createPostgresQueueActions(pool, () => "2099-01-01");
		assert.equal(await queue.callSpecific(999), null);
		assert.equal(
			(await pool.query("SELECT status FROM tickets WHERE id=1")).rows[0]
				.status,
			"called",
		);
		const results = await Promise.all([
			queue.callSpecific(3),
			queue.callSpecific(3),
		]);
		assert.equal(results.filter(Boolean).length, 1);
		assert.equal(
			(
				await pool.query(
					"SELECT count(*)::int AS n FROM tickets WHERE status='called'",
				)
			).rows[0].n,
			1,
		);
		const next = await queue.callNext();
		assert.equal(next.id, 2);
		assert.equal(next.service_name, "Услуга");
		const statuses = await pool.query(
			"SELECT id,status FROM tickets ORDER BY id",
		);
		assert.deepEqual(
			statuses.rows.map((x) => x.status),
			["served", "called", "served"],
		);
		const returned = await queue.returnCurrent();
		assert.equal(returned.id, 2);
		assert.equal(returned.status, "waiting");
		assert.equal(returned.called_at, null);
		assert.equal((await queue.callNext()).id, 2);
		const completed = await queue.complete("  Причина  ");
		assert.equal(completed.id, 2);
		assert.equal(completed.status, "served");
		assert.equal(completed.skip_reason, "Причина");
		assert.equal(await queue.complete(), null);
		assert.equal(await queue.returnCurrent(), null);
		assert.equal(await queue.callNext(), null);
		assert.deepEqual(await queue.returnSpecific(999), { result: "not_found" });
		assert.equal((await queue.returnSpecific(1)).result, "returned");
		assert.equal((await queue.returnSpecific(1)).result, "already_waiting");
		assert.equal(await queue.returnAll(), 2);
		await queue.callNext();
		await queue.reset();
		assert.equal(
			(
				await pool.query(
					"SELECT count(*)::int AS n FROM tickets WHERE status='served'",
				)
			).rows[0].n,
			3,
		);
		assert.equal(
			(
				await pool.query(
					"SELECT value FROM settings WHERE key='queue_reset_last_id'",
				)
			).rows[0].value,
			"3",
		);
	} finally {
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
		await admin.end();
	}
});
