const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createPostgresQueueRouter } = require("../routes/postgresQueue");
test("после совершённого вызова сбои уведомлений не возвращают ложную ошибку операции", async () => {
	let calls = 0,
		logs = 0,
		updates = 0;
	const app = express();
	app.use(
		"/queue",
		createPostgresQueueRouter({
			state: {
				getQueueState: async () => {
					throw Error("read failed");
				},
			},
			actions: {
				callNext: async () => {
					calls++;
					return { id: 1, number: 1 };
				},
			},
			requireAuth: (req, res, next) => next(),
			emitCalled: async () => {
				throw Error("socket failed");
			},
			emitQueueUpdate: async () => {
				updates++;
				throw Error("socket failed");
			},
			log: async () => {
				logs++;
				throw Error("logging failed");
			},
		}),
	);
	app.use((err, req, res, next) => res.sendStatus(500));
	const server = await new Promise((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	try {
		const response = await fetch(
			`http://127.0.0.1:${server.address().port}/queue/next`,
			{ method: "POST" },
		);
		const body = await response.json();
		assert.equal(response.status, 200);
		assert.match(body.warning, /Операция выполнена/);
		assert.equal(calls, 1);
		assert.equal(logs, 1);
		assert.equal(updates, 1);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});
