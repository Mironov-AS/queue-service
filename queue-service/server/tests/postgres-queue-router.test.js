const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createPostgresQueueRouter } = require("../routes/postgresQueue");
test("маршруты PostgreSQL требуют авторизацию и вызывают операции очереди", async () => {
	const app = express();
	app.use(express.json());
	const events = [];
	const current = { id: 1, number: 10 };
	const state = {
		getQueueState: async () => ({ current, waiting: [] }),
		getPublicQueueState: async () => ({ current: { id: 1 }, waiting: [] }),
	};
	const actions = {
		callNext: async () => current,
		callSpecific: async () => null,
		returnCurrent: async () => null,
		returnSpecific: async () => ({ result: "already_waiting" }),
		returnAll: async () => 2,
		complete: async () => null,
		reset: async () => {},
	};
	app.use(
		"/api/queue",
		createPostgresQueueRouter({
			state,
			actions,
			requireAuth: (req, res, next) =>
				req.headers.authorization === "test" ? next() : res.sendStatus(401),
			emitQueueUpdate: async () => events.push("update"),
			emitCalled: async (t) => events.push(`called:${t.number}`),
			log: async (req, action) => events.push(action),
		}),
	);
	app.use((err, req, res, next) =>
		res.status(500).json({ error: "Ошибка сервера" }),
	);
	const server = await new Promise((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	const base = `http://127.0.0.1:${server.address().port}/api/queue`;
	try {
		let r = await fetch(base);
		assert.equal(r.status, 200);
		assert.deepEqual(await r.json(), { current: { id: 1 }, waiting: [] });
		r = await fetch(`${base}/next`, { method: "POST" });
		assert.equal(r.status, 401);
		assert.deepEqual(events, []);
		const post = (path) =>
			fetch(base + path, {
				method: "POST",
				headers: { authorization: "test" },
			});
		r = await post("/next");
		assert.equal(r.status, 200);
		assert.equal((await r.json()).current.number, 10);
		assert.deepEqual(events, ["called:10", "ticket.called", "update"]);
		r = await post("/call/no");
		assert.equal(r.status, 400);
		r = await post("/call/2");
		assert.equal(r.status, 404);
		r = await post("/return/1");
		assert.equal(r.status, 400);
		r = await post("/return-all");
		assert.equal((await r.json()).returned, 2);
		r = await post("/reset");
		assert.deepEqual(await r.json(), { success: true });
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
