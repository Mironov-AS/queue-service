const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	bookingRepository,
	validateFields,
} = require("../services/bookingRepository");
test("обязательные поля, фильтрация посторонних полей и снимок названия", () => {
	const fields = [
		{ id: "phone", label: "Телефон", type: "phone", required: true },
	];
	assert.throws(() => validateFields(fields, {}), /Заполните/);
	assert.throws(
		() => validateFields(fields, { phone: "123", other: "x" }),
		/Неизвестное/,
	);
	assert.deepEqual(validateFields(fields, { phone: " 123 " }), {
		phone: { label: "Телефон", value: "123" },
	});
});
test("создание не принимает согласие без утверждённого текста", async () => {
	const repo = bookingRepository({});
	await assert.rejects(
		repo.create("id", { consent: true }, null),
		/утверждённое согласие/,
	);
});
test("сохранение настроек сохраняет постоянный идентификатор виджета", async () => {
	let sql = "";
	const repo = bookingRepository({
		query: async (q) => {
			sql = q;
			return { rows: [{ public_id: "stable" }] };
		},
	});
	const cfg = {
		enabled: true,
		duration_minutes: 30,
		capacity: 2,
		schedule: [{ day: 1, start: "09:00", end: "21:00" }],
		exceptions: [],
		fields: [],
		timezone: "Europe/Moscow",
	};
	assert.equal((await repo.saveConfig(3, cfg)).public_id, "stable");
	assert.match(sql, /ON CONFLICT\(service_id\) DO UPDATE/);
	assert.doesNotMatch(sql, /public_id=EXCLUDED/);
});

test("расписание проверяется даже если дата проверки указана как исключение", async () => {
	const repo = bookingRepository({
		query: async () => {
			throw new Error("в БД обращаться нельзя");
		},
	});
	const cfg = {
		enabled: true,
		duration_minutes: 30,
		capacity: 1,
		schedule: [
			{ day: 1, start: "09:00", end: "11:00" },
			{ day: 1, start: "10:00", end: "12:00" },
		],
		exceptions: ["2026-11-02"],
		fields: [],
		timezone: "Europe/Moscow",
	};
	await assert.rejects(repo.saveConfig(1, cfg), /пересекающиеся/);
});
test("часовой пояс обязателен и не подставляется из настроек сервера", async () => {
	const repo = bookingRepository({
		query: async () => {
			throw new Error("в БД обращаться нельзя");
		},
	});
	const cfg = {
		enabled: true,
		duration_minutes: 30,
		capacity: 1,
		schedule: [],
		exceptions: [],
		fields: [],
	};
	await assert.rejects(repo.saveConfig(1, cfg), /часовой пояс/);
});
test("ограничение числа полей не позволяет создавать чрезмерную форму", () => {
	const fields = Array.from({ length: 101 }, (_, i) => ({
		id: `f${i}`,
		label: `Поле ${i}`,
		type: "text",
	}));
	assert.throws(() => validateFields(fields, {}, true), /полей/);
});
