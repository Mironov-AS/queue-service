const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { validateTestDatabaseUrl } = require("./test-database-guard");
const { createPostgresQueueRouter } = require("../routes/postgresQueue");
const { createPostgresQueueState } = require("../services/postgresQueueState");
const {
	createPostgresQueueActions,
} = require("../services/postgresQueueActions");
const url = process.env.BOOKING_TEST_DATABASE_URL;
test("HTTP очередь PostgreSQL: авторизация, вызов, возврат и сброс", {
	skip: !url,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(url, process.env.BOOKING_TEST_ISOLATION_CONFIRMED);
	const schema = `queue_http_${crypto.randomBytes(12).toString("hex")}`;
	const admin = new Pool({
		connectionString: url,
		max: 1,
		connectionTimeoutMillis: 5000,
	});
	let pool,
		server,
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
		await pool.query(
			"INSERT INTO tickets(id,number,date,service_id,status,is_priority,field_values) VALUES(1,11,'2099-01-01',1,'waiting',0,'[]'),(2,12,'2099-01-01',1,'waiting',1,'[]')",
		);
		const state = createPostgresQueueState(pool, () => "2099-01-01");
		const actions = createPostgresQueueActions(pool, () => "2099-01-01");
		const events = [];
		const app = express();
		app.use(express.json());
		app.use(
			"/queue",
			createPostgresQueueRouter({
				state,
				actions,
				requireAuth: (req, res, next) =>
					req.headers.authorization === "test" ? next() : res.sendStatus(401),
				emitQueueUpdate: async () => events.push("update"),
				emitCalled: async (t) => events.push(`call:${t.id}`),
				log: async () => {},
			}),
		);
		app.use((err, req, res, next) =>
			res.status(500).json({ error: "Ошибка сервера" }),
		);
		server = await new Promise((resolve) => {
			const s = app.listen(0, "127.0.0.1", () => resolve(s));
		});
		const base = `http://127.0.0.1:${server.address().port}/queue`;
		const post = (p, auth = true) =>
			fetch(base + p, {
				method: "POST",
				headers: auth ? { authorization: "test" } : {},
			});
		assert.equal((await post("/next", false)).status, 401);
		let response = await post("/next");
		assert.equal(response.status, 200);
		let data = await response.json();
		assert.equal(data.current.id, 2);
		assert.equal(data.waiting[0].id, 1);
		assert.deepEqual(events, ["call:2", "update"]);
		response = await post("/return");
		data = await response.json();
		assert.equal(data.current, null);
		assert.equal(data.waiting.length, 2);
		response = await post("/call/1");
		data = await response.json();
		assert.equal(data.current.id, 1);
		response = await post("/complete");
		data = await response.json();
		assert.equal(data.current, null);
		assert.equal(data.waiting.length, 1);
		assert.equal((await post("/return-all")).status, 200);
		response = await post("/reset");
		assert.deepEqual(await response.json(), { success: true });
		assert.equal(
			(
				await pool.query(
					"SELECT count(*)::int AS n FROM tickets WHERE status='served'",
				)
			).rows[0].n,
			2,
		);
	} finally {
		if (server) await new Promise((resolve) => server.close(resolve));
		if (pool) await pool.end();
		if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
		await admin.end();
	}
});
