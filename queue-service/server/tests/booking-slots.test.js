const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateSlots } = require("../services/bookingSlots");
const config = {
	date: "2026-11-02",
	weekdays: [{ day: 1, start: "09:00", end: "11:00" }],
	durationMinutes: 30,
	capacity: 2,
};
test("расписание формирует слоты и не выходит за пределы дня", () => {
	const slots = calculateSlots(config);
	assert.deepEqual(
		slots.map((s) => s.start),
		["09:00", "09:30", "10:00", "10:30"],
	);
	assert.equal(slots[3].end, "11:00");
	assert.equal(slots[0].available, 2);
});
test("выходные и исключения недоступны", () => {
	assert.deepEqual(
		calculateSlots({ ...config, exceptions: ["2026-11-02"] }),
		[],
	);
	assert.deepEqual(calculateSlots({ ...config, date: "2026-11-03" }), []);
});
test("посты учитываются при полном и частичном пересечении", () => {
	const slots = calculateSlots({
		...config,
		bookings: [
			{ start: "09:00", end: "09:30" },
			{ start: "09:15", end: "09:45" },
		],
	});
	assert.equal(slots[0].booked, 2);
	assert.equal(slots[0].available, 0);
	assert.equal(slots[1].booked, 1);
	assert.equal(slots[1].available, 1);
});
test("соседние записи не считаются одновременными", () => {
	const slots = calculateSlots({
		...config,
		durationMinutes: 60,
		bookings: [
			{ start: "09:00", end: "09:30" },
			{ start: "09:30", end: "10:00" },
		],
	});
	assert.equal(slots[0].booked, 1);
	assert.equal(slots[0].available, 1);
});
test("некорректные и пересекающиеся интервалы отклоняются", () => {
	assert.throws(() => calculateSlots({ ...config, date: "2026-02-30" }));
	assert.throws(() => calculateSlots({ ...config, capacity: 0 }));
	assert.throws(() =>
		calculateSlots({
			...config,
			weekdays: [
				{ day: 1, start: "09:00", end: "10:00" },
				{ day: 1, start: "09:30", end: "11:00" },
			],
		}),
	);
	assert.throws(() =>
		calculateSlots({ ...config, bookings: [{ start: "10:00", end: "09:00" }] }),
	);
});
