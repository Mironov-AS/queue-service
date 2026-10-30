const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBookingRouter } = require("../routes/booking");
const publicId = "01234567-89ab-4cde-8123-0123456789ab";
async function withServer(run, overrides = {}) {
	const repo = {
		getPublic: async () => ({ slots: [], fields: [] }),
		create: async () => ({ id: 1 }),
		getConfig: async () => ({}),
		saveConfig: async () => ({}),
		getCalendar: async () => ({}),
		cancel: async () => true,
	};
	Object.assign(repo, overrides);
	const app = express();
	app.use(express.json());
	app.use(
		"/api/booking",
		createBookingRouter({
			repository: repo,
			approvedConsent: {
				version: "v1",
				text: "Согласие",
				agreementText: "Соглашение",
				agreementUrl: "/agreement",
				agreementTitle: "Пользовательское соглашение",
				policyUrl: "/privacy",
				consentUrl: "/consent",
			},
			requireAuth: (_req, res) =>
				res.status(401).json({ error: "Не авторизован" }),
			requireAdmin: (_req, _res, next) => next(),
		}),
	);
	const server = app.listen(0, "127.0.0.1");
	await new Promise((r) => server.once("listening", r));
	try {
		await run(`http://127.0.0.1:${server.address().port}/api/booking`);
	} finally {
		await new Promise((r) => server.close(r));
	}
}
test("настройка API без утверждённого согласия запрещена", () =>
	assert.throws(
		() =>
			createBookingRouter({
				repository: {},
				requireAuth: () => {},
				requireAdmin: () => {},
			}),
		/согласие/,
	));
test("публичная форма получает серверную версию согласия", () =>
	withServer(async (base) => {
		const r = await fetch(`${base}/public/${publicId}?date=2026-11-02`);
		assert.equal(r.status, 200);
		const consent = (await r.json()).consent;
		assert.equal(consent.version, "v1");
		assert.equal(consent.policyUrl, "/privacy");
		assert.equal(consent.consentUrl, "/consent");
		assert.equal(consent.agreementUrl, "/agreement");
		assert.equal(consent.agreementTitle, "Пользовательское соглашение");
	}));
test("утверждённое согласие сервиса записи содержит ссылку на соглашение и реквизиты", () => {
	const { bookingConsent } = require("../services/bookingConsent");
	assert.ok(bookingConsent.version, "должна быть версия согласия");
	assert.match(bookingConsent.text, /Пользовательск/);
	assert.match(bookingConsent.text, /150304643015/);
	assert.equal(bookingConsent.agreementUrl, "/agreement");
	assert.equal(bookingConsent.policyUrl, "/privacy");
	assert.equal(bookingConsent.consentUrl, "/consent");
	assert.doesNotMatch(bookingConsent.text, /Технический текст/);
});
test("чужая или устаревшая версия согласия отклоняется", () =>
	withServer(async (base) => {
		const r = await fetch(`${base}/public/${publicId}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				date: "2026-11-02",
				consent: true,
				consentVersion: "old",
			}),
		});
		assert.equal(r.status, 409);
	}));
test("административные данные не раскрываются без входа", () =>
	withServer(async (base) => {
		const r = await fetch(`${base}/services/1/calendar?date=2026-11-02`);
		assert.equal(r.status, 401);
	}));

test("нельзя включить запись без ссылок на документы или с небезопасным адресом", () => {
	const guards = {
		repository: {},
		requireAuth: () => {},
		requireAdmin: () => {},
	};
	assert.throws(
		() =>
			createBookingRouter({
				...guards,
				approvedConsent: { version: "v1", text: "Текст" },
			}),
		/согласие/,
	);
	assert.throws(
		() =>
			createBookingRouter({
				...guards,
				approvedConsent: {
					version: "v1",
					text: "Текст",
					policyUrl: "javascript:alert(1)",
					consentUrl: "/consent",
				},
			}),
		/согласие/,
	);
});

test("ошибка соединения с БД не раскрывает внутренние данные", () =>
	withServer(
		async (base) => {
			const r = await fetch(`${base}/public/${publicId}?date=2026-11-02`);
			assert.equal(r.status, 500);
			assert.deepEqual(await r.json(), { error: "Ошибка сервера" });
		},
		{
			getPublic: async () => {
				const e = new Error("secret database host and credential");
				e.code = "ECONNREFUSED";
				throw e;
			},
		},
	));
test("ошибка валидации формы передаётся клиенту", () =>
	withServer(
		async (base) => {
			const r = await fetch(`${base}/public/${publicId}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					date: "2026-11-02",
					consent: true,
					agreement: true,
					consentVersion: "v1",
				}),
			});
			assert.equal(r.status, 400);
			assert.equal((await r.json()).error, "Заполните поле: Телефон");
		},
		{
			create: async () => {
				throw new Error("Заполните поле: Телефон");
			},
		},
	));
test("каждая из двух отметок обязательна на сервере", () =>
	withServer(async (base) => {
		for (const [agreement, consent] of [
			[false, true],
			[true, false],
			[false, false],
		]) {
			const r = await fetch(`${base}/public/${publicId}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					date: "2026-11-02",
					agreement,
					consent,
					consentVersion: "v1",
				}),
			});
			assert.equal(r.status, 400);
		}
	}));
