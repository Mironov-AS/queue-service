// Pure calculation in the service's local calendar. Persistence and locking belong to the database layer.
function minutes(value) {
	if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
		throw new Error("Некорректное время");
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}
function time(n) {
	return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
function validateDate(date) {
	if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
		throw new Error("Некорректная дата");
	const d = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== date)
		throw new Error("Некорректная дата");
	return d;
}
// Max simultaneous bookings inside [start,end), even if existing reservations start at different times.
function maximumOverlap(start, end, bookings) {
	const events = [];
	for (const b of bookings) {
		const a = minutes(b.start),
			z = minutes(b.end);
		if (z <= a) throw new Error("Некорректный интервал записи");
		if (a < end && z > start) {
			events.push([Math.max(a, start), 1], [Math.min(z, end), -1]);
		}
	}
	events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let current = 0,
		max = 0;
	for (const [, delta] of events) {
		current += delta;
		max = Math.max(max, current);
	}
	return max;
}
function calculateSlots({
	date,
	weekdays,
	exceptions = [],
	durationMinutes,
	stepMinutes = durationMinutes,
	capacity,
	bookings = [],
}) {
	const day = validateDate(date);
	if (
		!Number.isInteger(durationMinutes) ||
		durationMinutes < 1 ||
		durationMinutes > 1440 ||
		!Number.isInteger(stepMinutes) ||
		stepMinutes < 1 ||
		stepMinutes > 1440 ||
		!Number.isInteger(capacity) ||
		capacity < 1 ||
		capacity > 100
	)
		throw new Error("Некорректные настройки записи");
	if (
		!Array.isArray(weekdays) ||
		!Array.isArray(exceptions) ||
		!Array.isArray(bookings)
	)
		throw new Error("Некорректное расписание");
	if (exceptions.includes(date)) return [];
	const periods = weekdays
		.filter((p) => p.day === day.getUTCDay())
		.map((p) => ({ start: minutes(p.start), end: minutes(p.end) }))
		.sort((a, b) => a.start - b.start);
	periods.forEach((p, i) => {
		if (p.end <= p.start || (i && p.start < periods[i - 1].end))
			throw new Error("Некорректные или пересекающиеся интервалы расписания");
	});
	const slots = [];
	for (const period of periods) {
		for (
			let start = period.start;
			start + durationMinutes <= period.end;
			start += stepMinutes
		) {
			const end = start + durationMinutes;
			const booked = maximumOverlap(start, end, bookings);
			slots.push({
				start: time(start),
				end: time(end),
				booked,
				available: Math.max(0, capacity - booked),
				capacity,
			});
		}
	}
	return slots;
}
module.exports = { calculateSlots, maximumOverlap };
