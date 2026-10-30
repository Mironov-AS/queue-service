// The queue channel of a service can be switched off, so that the service
// exists only in the booking channel. The directory itself always lists it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-services-"));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = "test-secret-for-services-channel";

const express = require("express");
const jwt = require("jsonwebtoken");
const servicesRouter = require("../routes/services");

function token() {
	return jwt.sign({ id: 1, username: "admin", role: "admin" }, "test-secret-for-services-channel");
}

async function withServer(run) {
	const app = express();
	app.use(express.json());
	app.use("/api/services", servicesRouter);
	const server = app.listen(0, "127.0.0.1");
	await new Promise((r) => server.once("listening", r));
	try {
		await run(`http://127.0.0.1:${server.address().port}/api/services`, {
			Authorization: `Bearer ${token()}`,
		});
	} finally {
		await new Promise((r) => server.close(r));
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
}

test("услуга создаётся только с каналом «Запись», без канала «Очередь»", () =>
	withServer(async (base, headers) => {
		const created = await fetch(base, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Диагностика подвески",
				description: "Только предварительная запись",
				avg_duration_minutes: 20,
				enabled: false,
			}),
		});
		assert.equal(created.status, 200);
		const service = await created.json();
		assert.equal(service.enabled, 0);

		// The public list of the queue channel does not contain the service.
		const publicList = await fetch(base);
		assert.equal(publicList.status, 200);
		const publicServices = await publicList.json();
		assert.equal(
			publicServices.some((s) => s.id === service.id),
			false,
		);

		// The administrator directory contains it with the queue channel off.
		const adminList = await fetch(`${base}?all=1`, { headers });
		assert.equal(adminList.status, 200);
		const adminServices = await adminList.json();
		const inDirectory = adminServices.find((s) => s.id === service.id);
		assert.ok(inDirectory, "услуга должна быть в справочнике");
		assert.equal(inDirectory.enabled, 0);
	}));

test("канал «Очередь» включается и выключается независимо", () =>
	withServer(async (base, headers) => {
		const created = await fetch(base, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Услуга с очередью", enabled: false }),
		});
		const service = await created.json();
		assert.equal(service.enabled, 0);

		const updated = await fetch(`${base}/${service.id}`, {
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Услуга с очередью",
				avg_duration_minutes: 5,
				priority: 0,
				daily_limit: null,
				enabled: true,
			}),
		});
		assert.equal(updated.status, 200);
		assert.equal((await updated.json()).enabled, 1);

		// Without the field the channel state is not changed by a rename.
		const renamed = await fetch(`${base}/${service.id}`, {
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Переименованная услуга",
				avg_duration_minutes: 5,
				priority: 0,
				daily_limit: null,
			}),
		});
		assert.equal(renamed.status, 200);
		assert.equal((await renamed.json()).enabled, 1);
	}));
