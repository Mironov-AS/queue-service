const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createBookingRouter } = require("../routes/booking");
const { bookingRepository } = require("../services/bookingRepository");
const { calculateSlots } = require("../services/bookingSlots");

const publicId = "01234567-89ab-4cde-8123-0123456789ab";

async function withServer(run, overrides = {}) {
	const repo = {
		getPublic: async () => ({ slots: [], fields: [] }),
		create: async () => ({ id: 1 }),
		getConfig: async () => ({}),
		saveConfig: async () => ({}),
		getCalendar: async () => ({}),
		cancel: async () => true,
		getAvailability: async () => ({
			month: "2026-11",
			timezone: "Europe/Moscow",
			days: [],
		}),
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(
		"/api/booking",
		createBookingRouter({
			repository: repo,
			approvedConsent: {
				version: "v1",
				text: "Согласие",
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

test("месяц запрашивается без параметра и возвращает дни с согласием", () =>
	withServer(async (base) => {
		const calls = [];
		const r = await fetch(`${base}/public/${publicId}/month`);
		assert.equal(r.status, 200);
		const body = await r.json();
		assert.equal(body.month, "2026-11");
		assert.equal(body.timezone, "Europe/Moscow");
		assert.equal(body.consent.version, "v1");
		assert.equal(body.consent.policyUrl, "/privacy");
		assert.equal(body.consent.consentUrl, "/consent");
		assert.ok(Array.isArray(body.days));
		calls.push(1);
	}));

test("некорректный месяц отклоняется", () =>
	withServer(async (base) => {
		for (const month of ["2026-13", "2026-1", "ноябрь", "2026-11-01"]) {
			const r = await fetch(
				`${base}/public/${publicId}/month?month=${encodeURIComponent(month)}`,
			);
			assert.equal(r.status, 400, month);
		}
	}));

test("корректный месяц передаётся в репозиторий", () =>
	withServer(
		async (base) => {
			const r = await fetch(`${base}/public/${publicId}/month?month=2026-12`);
			assert.equal(r.status, 200);
		},
		{
			getAvailability: async (_id, month) => {
				assert.equal(month, "2026-12");
				return { month, timezone: "Europe/Moscow", days: [] };
			},
		},
	));

test("недоступная услуга скрывает календарь", () =>
	withServer(
		async (base) => {
			const r = await fetch(`${base}/public/${publicId}/month`);
			assert.equal(r.status, 404);
		},
		{ getAvailability: async () => null },
	));

test("некорректный идентификатор виджета отклоняется", () =>
	withServer(async (base) => {
		const r = await fetch(`${base}/public/not-a-uuid/month`);
		assert.equal(r.status, 400);
	}));

// Availability of a day is derived from the schedule, the exceptions and the
// existing bookings — the same rules the booking itself enforces.
function dayAvailability(config, bookings, date, now) {
	const slots = calculateSlots({
		date,
		weekdays: config.schedule,
		exceptions: config.exceptions,
		durationMinutes: config.duration_minutes,
		capacity: config.capacity,
		bookings,
	});
	return slots;
}

test("расчёт дней учитывает выходные, исключения и занятость", () => {
	const config = {
		schedule: [
			{ day: 1, start: "09:00", end: "12:00" },
			{ day: 2, start: "09:00", end: "12:00" },
		],
		exceptions: ["2026-11-03"],
		duration_minutes: 60,
		capacity: 1,
	};
	// Monday: two slots, Tuesday is an exception, Sunday is not a working day.
	assert.equal(dayAvailability(config, [], "2026-11-02", "09:00").length, 3);
	assert.equal(dayAvailability(config, [], "2026-11-03", "09:00").length, 0);
	assert.equal(dayAvailability(config, [], "2026-11-01", "09:00").length, 0);
	// A fully booked Monday leaves no free seat.
	const busy = dayAvailability(config, [], "2026-11-02", "09:00").map((s) => ({
		start: s.start,
		end: s.end,
	}));
	const free = dayAvailability(config, busy, "2026-11-02", "09:00").every(
		(s) => s.available === 0,
	);
	assert.equal(free, true);
});

test("запрос месяца не раскрывает данные клиентов", () =>
	withServer(
		async (base) => {
			const r = await fetch(`${base}/public/${publicId}/month?month=2026-11`);
			const text = await r.text();
			assert.equal(r.status, 200);
			assert.ok(!text.includes("field_values"));
			assert.ok(!text.includes("phone"));
		},
		{
			getAvailability: async () => ({
				month: "2026-11",
				timezone: "Europe/Moscow",
				name: "Услуга",
				description: "",
				days: [{ date: "2026-11-02", available: true, reason: null, free: 3 }],
			}),
		},
	));

// ─── Administrative month overview ────────────────────────────────────────────

async function withAdminServer(run, overrides = {}, role = "admin") {
	const repo = {
		getPublic: async () => ({ slots: [], fields: [] }),
		create: async () => ({ id: 1 }),
		getConfig: async () => ({}),
		saveConfig: async () => ({}),
		getCalendar: async () => ({}),
		cancel: async () => true,
		getAvailability: async () => null,
		getAdminBookings: async () => ({ month: "2026-11", bookings: [] }),
		getServiceChannels: async () => [],
		getAdminMonth: async () => ({
			month: "2026-11",
			timezone: "Europe/Moscow",
			days: [],
		}),
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(
		"/api/booking",
		createBookingRouter({
			repository: repo,
			approvedConsent: {
				version: "v1",
				text: "Согласие",
				policyUrl: "/privacy",
				consentUrl: "/consent",
			},
			requireAuth: (req, res, next) =>
				role
					? ((req.user = { id: 1, role }), next())
					: res.status(401).json({ error: "Не авторизован" }),
			requireAdmin: (req, res, next) =>
				req.user?.role === "admin"
					? next()
					: res.status(403).json({ error: "Доступ запрещён" }),
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

test("месячный обзор администратора доступен только после входа", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/month?month=2026-11`);
			assert.equal(r.status, 401);
		},
		{},
		null,
	));

test("месячный обзор недоступен без прав администратора", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/month?month=2026-11`);
			assert.equal(r.status, 403);
		},
		{},
		"operator",
	));

test("месячный обзор отклоняет некорректный месяц", () =>
	withAdminServer(async (base) => {
		const r = await fetch(`${base}/services/1/month?month=2026-13`);
		assert.equal(r.status, 400);
	}));

test("месячный обзор отдаёт счётчики по дням", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/month?month=2026-11`);
			assert.equal(r.status, 200);
			const body = await r.json();
			assert.equal(body.month, "2026-11");
			assert.equal(body.days[0].date, "2026-11-01");
			assert.equal(typeof body.days[0].booked, "number");
			assert.equal(typeof body.days[0].free, "number");
		},
		{
			getAdminMonth: async (_id, month) => ({
				month,
				timezone: "Europe/Moscow",
				days: [{ date: `${month}-01`, slots: 6, capacity: 12, booked: 2, free: 10 }],
			}),
		},
	));

test("месячный обзор скрывает услугу без расписания", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/month?month=2026-11`);
			assert.equal(r.status, 404);
		},
		{ getAdminMonth: async () => null },
	));

test("список записей за месяц доступен только администратору", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/bookings?month=2026-11`);
			assert.equal(r.status, 401);
		},
		{},
		null,
	));

test("список записей за месяц отклоняет некорректный месяц", () =>
	withAdminServer(async (base) => {
		const r = await fetch(`${base}/services/1/bookings?month=2026-13`);
		assert.equal(r.status, 400);
	}));

test("список записей за месяц возвращает данные клиентов", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/bookings?month=2026-11`);
			assert.equal(r.status, 200);
			const body = await r.json();
			assert.equal(body.month, "2026-11");
			assert.equal(body.bookings.length, 1);
			assert.equal(body.bookings[0].date, "2026-11-03");
			assert.equal(body.bookings[0].start, "09:00");
			assert.equal(body.bookings[0].answers.car.value, "А123ВС77");
		},
		{
			getAdminBookings: async (_id, month) => ({
				month,
				timezone: "Europe/Moscow",
				bookings: [
					{
						id: 1,
						date: "2026-11-03",
						start: "09:00",
						end: "09:30",
						answers: { car: { label: "Номер авто", value: "А123ВС77" } },
					},
				],
			}),
		},
	));

test("список записей скрывает услугу без расписания", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services/1/bookings?month=2026-11`);
			assert.equal(r.status, 404);
		},
		{ getAdminBookings: async () => null },
	));

test("состояние каналов услуг доступно только администратору", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services`);
			assert.equal(r.status, 401);
		},
		{},
		null,
	));

test("состояние каналов услуг недоступно оператору", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services`);
			assert.equal(r.status, 403);
		},
		{},
		"operator",
	));

test("состояние каналов показывает включённый канал записи и постоянный идентификатор виджета", () =>
	withAdminServer(
		async (base) => {
			const r = await fetch(`${base}/services`);
			assert.equal(r.status, 200);
			const body = await r.json();
			assert.equal(body.services.length, 2);
			assert.deepEqual(body.services[0], {
				id: 2,
				name: "Только запись",
				booking_enabled: false,
				public_id: null,
			});
			assert.equal(body.services[1].booking_enabled, true);
			assert.equal(body.services[1].public_id, publicId);
		},
		{
			getServiceChannels: async () => [
				{
					id: 2,
					name: "Только запись",
					booking_enabled: false,
					public_id: null,
				},
				{
					id: 1,
					name: "Ремонт ГБО",
					booking_enabled: true,
					public_id: publicId,
				},
			],
		},
	));
