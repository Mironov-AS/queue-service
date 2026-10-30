const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createPostgresQueueState } = require("../services/postgresQueueState");
const { validateTestDatabaseUrl } = require("./test-database-guard");
const url = process.env.BOOKING_TEST_DATABASE_URL;
test("PostgreSQL: состояние очереди, приоритет, разделение публичных и полных данных", {
	skip: !url,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(url, process.env.BOOKING_TEST_ISOLATION_CONFIRMED);
	const schema = `queue_state_${crypto.randomBytes(12).toString("hex")}`;
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
			max: 2,
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
		await pool.query(`INSERT INTO tickets(id,number,date,service_id,status,is_priority,name,phone,field_values,created_at,called_at) VALUES
  (1,1,'2099-01-01',1,'waiting',0,'Иван','123','[]','2099-01-01 09:00:00',NULL),
  (2,2,'2099-01-01',1,'waiting',1,'Ольга','456','[]','2099-01-01 10:00:00',NULL),
  (3,3,'2099-01-01',1,'called',0,'Анна','789','[]','2099-01-01 08:00:00','2099-01-01 11:00:00'),
  (4,4,'2099-01-02',1,'waiting',1,'Другая дата','000','[]','2099-01-02 09:00:00',NULL)`);
		const store = createPostgresQueueState(pool, () => "2099-01-01");
		const full = await store.getQueueState();
		assert.equal(full.current.id, 3);
		assert.deepEqual(
			full.waiting.map((x) => x.id),
			[2, 1],
		);
		assert.equal(full.waiting[0].phone, "456");
		const pub = await store.getPublicQueueState();
		assert.equal(pub.current.id, 3);
		assert.deepEqual(
			pub.waiting.map((x) => x.id),
			[2, 1],
		);
		assert.equal("phone" in pub.waiting[0], false);
		assert.equal("name" in pub.waiting[0], false);
	} finally {
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
		await admin.end();
	}
});
