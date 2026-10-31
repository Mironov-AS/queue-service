// Check of the login attempt limiter.
//
// The service is published through a proxy, so limiting by IP would block all
// administrators at once. The limiter must count only failed attempts and
// must keep separate budgets per account.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
	loginLimiter,
	accountKey,
	MAX_ATTEMPTS,
} = require("../middleware/loginLimiter");

function makeApp() {
	const app = express();
	app.use(express.json());
	app.post(
		"/login",
		loginLimiter,
		(req, res) => {
			if (req.body && req.body.ok) return res.json({ token: "ok" });
			return res.status(401).json({ error: "Неверный логин или пароль" });
		},
	);
	return app;
}

function request(app, body) {
	return new Promise((resolve, reject) => {
		const server = app.listen(0, () => {
			const { port } = server.address();
			const payload = JSON.stringify(body);
			const req = require("node:http").request(
				{
					host: "127.0.0.1",
					port,
					path: "/login",
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(payload),
					},
				},
				(res) => {
					res.resume();
					res.on("end", () => {
						server.close(() => resolve(res.statusCode));
					});
				},
			);
			req.on("error", reject);
			req.end(payload);
		});
	});
}

test("ключ лимитера — учётная запись, а не адрес", () => {
	assert.equal(
		accountKey({ body: { username: "  Admin " } }),
		"admin",
	);
	assert.equal(accountKey({ body: {} }), "без-имени");
	assert.notEqual(
		accountKey({ body: { username: "admin" } }),
		accountKey({ body: { username: "operator" } }),
	);
});

test("успешные входы не тратят лимит, неудачные — тратят", async () => {
	const app = makeApp();
	for (let i = 0; i < MAX_ATTEMPTS + 5; i += 1) {
		const status = await request(app, { username: "good", ok: true });
		assert.equal(status, 200, "успешный вход должен проходить");
	}
	for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
		const status = await request(app, { username: "good" });
		assert.equal(status, 401, "неудачный вход должен отклоняться");
	}
	const blocked = await request(app, { username: "good" });
	assert.equal(blocked, 429, "после лимита неудачных попыток вход блокируется");
});

test("у разных учётных записей отдельный лимит", async () => {
	const app = makeApp();
	for (let i = 0; i < MAX_ATTEMPTS + 1; i += 1) {
		await request(app, { username: "blocked-account" });
	}
	assert.equal(await request(app, { username: "blocked-account" }), 429);
	const other = await request(app, { username: "another-account" });
	assert.equal(other, 401, "другая учётная запись не должна блокироваться");
});
