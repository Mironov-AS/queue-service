// Сквозная проверка записи на промышленной ВМ (репетиция).
// Запуск: node smoke-booking.js <baseUrl> <rehearsalDataDir> <releaseServerDir>
const fs = require("fs");
const path = require("path");

const base = process.argv[2] || "http://127.0.0.1:3002";
const rehDir = process.argv[3] || "/opt/rehearsal";
const relDir =
	process.argv[4] || "/opt/queue-service/releases/2026-10-30-booking/server";

const Database = require(path.join(relDir, "node_modules/better-sqlite3"));
const jwt = require(path.join(relDir, "node_modules/jsonwebtoken"));

function adminToken() {
	const db = new Database(path.join(rehDir, "queue.db"), { readonly: true });
	try {
		const secret = db
			.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'")
			.get().value;
		return jwt.sign({ id: 1, username: "admin", role: "admin" }, secret, {
			expiresIn: "1h",
		});
	} finally {
		db.close();
	}
}

let failures = 0;
function check(name, ok, extra = "") {
	console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
	if (!ok) failures++;
}

async function req(pathname, options = {}) {
	const res = await fetch(base + pathname, options);
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* не JSON */
	}
	return { status: res.status, text, json };
}

function nextWeekday() {
	const d = new Date();
	d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
	return d.toISOString().slice(0, 10);
}

(async () => {
	const token = adminToken();
	const auth = { Authorization: "Bearer " + token };
	const date = nextWeekday();

	// 1. Служебные маршруты и очередь
	const health = await req("/health");
	check("GET /health", health.status === 200 && health.json?.status === "ok");
	const queue = await req("/api/queue");
	check("GET /api/queue (очередь жива)", queue.status === 200);

	// 2. Доступ к админке записи защищён
	const noToken = await req("/api/booking/services");
	check("GET /api/booking/services без токена → 401", noToken.status === 401);
	const withToken = await req("/api/booking/services", { headers: auth });
	check(
		"GET /api/booking/services с админом → 200",
		withToken.status === 200 && Array.isArray(withToken.json?.services),
		JSON.stringify(withToken.json).slice(0, 120),
	);

	// 3. Настройка расписания услуги (как это делает админ в интерфейсе)
	const config = await req("/api/booking/services/1/config", {
		method: "PUT",
		headers: { ...auth, "Content-Type": "application/json" },
		body: JSON.stringify({
			enabled: true,
			duration_minutes: 30,
			capacity: 2,
			timezone: "Europe/Moscow",
			schedule: [
				{ day: 1, start: "09:00", end: "12:00" },
				{ day: 2, start: "09:00", end: "12:00" },
				{ day: 3, start: "09:00", end: "12:00" },
				{ day: 4, start: "09:00", end: "12:00" },
				{ day: 5, start: "09:00", end: "12:00" },
			],
			exceptions: [],
			fields: [
				{ id: "phone", label: "Телефон", type: "phone", required: true },
			],
		}),
	});
	check(
		"PUT /api/booking/services/1/config → 200",
		config.status === 200,
		JSON.stringify(config.json).slice(0, 160),
	);
	const publicId = config.json?.public_id;
	check("постоянный public_id получен", !!publicId, String(publicId));

	// 4. Публичный виджет
	const pub = await req(`/api/booking/public/${publicId}?date=${date}`);
	check("GET /api/booking/public/:id → 200", pub.status === 200);
	check(
		"в ответе есть слоты и текст согласия",
		Array.isArray(pub.json?.slots) &&
			pub.json.slots.length > 0 &&
			!!pub.json?.consent?.text &&
			!!pub.json?.consent?.version,
		`слотов: ${pub.json?.slots?.length}, версия: ${pub.json?.consent?.version}`,
	);
	const first = pub.json?.slots?.[0];
	check(
		"есть свободный слот",
		!!first && first.available > 0,
		JSON.stringify(first),
	);

	// 5. Создание записи с согласием
	const slot = pub.json.slots.find((s) => s.available > 0);
	const booking = await req(`/api/booking/public/${publicId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			date,
			start: slot.start,
			answers: { phone: "+7 900 000-00-00" },
			consent: true,
			consentVersion: pub.json.consent.version,
		}),
	});
	check(
		"POST /api/booking/public/:id → 201",
		booking.status === 201,
		JSON.stringify(booking.json).slice(0, 160),
	);

	// 6. Запись без согласия отклоняется
	const noConsent = await req(`/api/booking/public/${publicId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			date,
			start: slot.start,
			answers: { phone: "+7 900 000-00-00" },
		}),
	});
	check("запись без согласия отклоняется", noConsent.status >= 400);

	// 7. Переполнение слота (вместимость 2)
	const second = await req(`/api/booking/public/${publicId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			date,
			start: slot.start,
			answers: { phone: "+7 900 000-00-01" },
			consent: true,
			consentVersion: pub.json.consent.version,
		}),
	});
	check("вторая запись в тот же слот проходит", second.status === 201);
	const third = await req(`/api/booking/public/${publicId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			date,
			start: slot.start,
			answers: { phone: "+7 900 000-00-02" },
			consent: true,
			consentVersion: pub.json.consent.version,
		}),
	});
	check(
		"третья запись в слот отклоняется",
		third.status >= 400,
		`статус ${third.status}`,
	);

	// 8. Календарь администратора показывает данные клиента
	const cal = await req(`/api/booking/services/1/calendar?date=${date}`, {
		headers: auth,
	});
	const booked = (cal.json?.bookings || [])[0];
	check(
		"календарь администратора содержит запись с данными клиента",
		cal.status === 200 &&
			!!booked &&
			JSON.stringify(booked.answers).includes("+7 900 000-00-00") &&
			(cal.json?.slots || []).some((s) => s.booked > 0),
		JSON.stringify(cal.json).slice(0, 220),
	);

	// 9. Отмена записи
	const bookingId = booked?.id;
	const cancel = await req(
		`/api/booking/services/1/bookings/${bookingId}/cancel`,
		{ method: "POST", headers: auth },
	);
	check(
		"отмена записи → 200",
		cancel.status === 200,
		JSON.stringify(cancel.json),
	);

	// 10. Страницы интерфейса
	const visitor = await req("/visitor");
	check(
		"GET /visitor → 200 HTML",
		visitor.status === 200 && visitor.text.includes("<html"),
	);
	const widget = await req(`/booking/${publicId}`);
	check(
		"GET /booking/:publicId → 200 HTML",
		widget.status === 200 && widget.text.includes("<html"),
	);
	const agreement = await req("/agreement");
	check("GET /agreement → 200 HTML", agreement.status === 200);

	console.log(
		failures === 0
			? "ИТОГ: все проверки пройдены"
			: `ИТОГ: провалов ${failures}`,
	);
	process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
	console.error("ОШИБКА:", err);
	process.exit(1);
});
