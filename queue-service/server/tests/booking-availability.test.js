const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBookingAvailability } = require("../routes/bookingAvailability");

async function request(router, path, options) {
	const app = express();
	app.use("/api/booking", router);
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	try {
		return await fetch(
			`http://127.0.0.1:${server.address().port}/api/booking${path}`,
			options,
		);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}
test("по умолчанию любые маршруты записи отвечают недоступностью и не вызывают обработчик", async () => {
	let calls = 0;
	const router = createBookingAvailability({
		bookingRouter: (_req, res) => {
			calls++;
			res.end();
		},
	});
	for (const [path, method] of [
		["/public/anything", "GET"],
		["/public/anything", "POST"],
		["/services/1/config", "PUT"],
	]) {
		const result = await request(router, path, { method });
		assert.equal(result.status, 503);
		assert.deepEqual(await result.json(), {
			error: "Запись временно недоступна",
		});
	}
	assert.equal(calls, 0);
});
test("включение без внедрённого маршрутизатора запрещено", () => {
	assert.throws(
		() => createBookingAvailability({ enabled: true }),
		/маршрутизатора/,
	);
});
test("явно включённый шлюз передаёт запрос только внедрённому маршрутизатору", async () => {
	const router = createBookingAvailability({
		enabled: true,
		bookingRouter: (_req, res) => res.status(204).end(),
	});
	assert.equal((await request(router, "/probe")).status, 204);
});
