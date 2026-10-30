const { calculateSlots } = require("./bookingSlots");

// These tables are intended to coexist with the migrated PostgreSQL services table.
// Run explicitly against an isolated test database; never on startup against an unknown database.
const schema = `
CREATE TABLE IF NOT EXISTS booking_config (
 service_id INTEGER PRIMARY KEY REFERENCES services(id),
 public_id UUID NOT NULL UNIQUE,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
 capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100),
 schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
 exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
 fields JSONB NOT NULL DEFAULT '[]'::jsonb,
 timezone TEXT NOT NULL DEFAULT 'Europe/Moscow'
);
CREATE TABLE IF NOT EXISTS bookings (
 id BIGSERIAL PRIMARY KEY,
 service_id INTEGER NOT NULL REFERENCES services(id),
 booking_date DATE NOT NULL,
 start_time TIME NOT NULL,
 end_time TIME NOT NULL CHECK (end_time > start_time),
 answers JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
 consent_version TEXT NOT NULL,
 consent_text TEXT NOT NULL,
 consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreement_text TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreement_accepted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bookings_service_day ON bookings(service_id,booking_date) WHERE status='booked';`;

function validateFields(fields, answers, schemaOnly = false) {
	if (
		!Array.isArray(fields) ||
		!answers ||
		typeof answers !== "object" ||
		Array.isArray(answers)
	)
		throw new Error("Некорректные данные формы");
	if (fields.length > 100) throw new Error("Слишком много полей формы");
	const allowed = new Set();
	const result = {};
	for (const f of fields) {
		if (
			!f ||
			typeof f.id !== "string" ||
			!/^[a-zA-Z0-9_-]{1,64}$/.test(f.id) ||
			allowed.has(f.id) ||
			typeof f.label !== "string" ||
			!f.label.trim() ||
			f.label.length > 120 ||
			!["text", "phone", "email", "number", "date", "textarea"].includes(f.type)
		)
			throw new Error("Некорректная настройка полей");
		allowed.add(f.id);
		const v = answers[f.id];
		if (v != null && typeof v !== "string")
			throw new Error("Некорректное значение поля");
		const text = (v || "").trim();
		if (!schemaOnly && f.required && !text)
			throw new Error(`Заполните поле: ${f.label}`);
		if (text.length > 1000) throw new Error("Слишком длинное значение поля");
		if (text) result[f.id] = { label: f.label, value: text };
	}
	if (Object.keys(answers).some((k) => !allowed.has(k)))
		throw new Error("Неизвестное поле формы");
	return result;
}
function localNow(timeZone) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date());
	const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	return {
		date: `${o.year}-${o.month}-${o.day}`,
		time: `${o.hour}:${o.minute}`,
	};
}

// "YYYY-MM" of the month that contains the given local date.
function monthOf(date) {
	return date.slice(0, 7);
}
function monthRange(month) {
	const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
	if (!m) throw new Error("Некорректный месяц");
	const year = Number(m[1]),
		mon = Number(m[2]);
	if (year < 2000 || year > 2100) throw new Error("Некорректный месяц");
	const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
	return { year, mon, days, first: `${month}-01`, last: `${month}-${days}` };
}
function configSlots(config, date, bookings) {
	return calculateSlots({
		date,
		weekdays: config.schedule,
		exceptions: config.exceptions,
		durationMinutes: config.duration_minutes,
		capacity: config.capacity,
		bookings,
	});
}
function bookingRepository(pool) {
	return {
		schema,
		// The same public id is preserved whenever booking is disabled and re-enabled.
		// Channel state of every service: is the booking channel on and does the
		// service already have its permanent widget id. The queue channel state
		// lives in the queue database and is merged by the client.
		async getServiceChannels() {
			const rows = await pool.query(
				"SELECT s.id,s.name,COALESCE(b.enabled,false) AS booking_enabled,b.public_id FROM services s LEFT JOIN booking_config b ON b.service_id = s.id WHERE s.active = 1 ORDER BY s.name",
			);
			return rows.rows.map((row) => ({
				id: row.id,
				name: row.name,
				booking_enabled: row.booking_enabled === true,
				public_id: row.public_id || null,
			}));
		},
		async saveConfig(serviceId, config) {
			if (
				!Number.isInteger(serviceId) ||
				serviceId < 1 ||
				typeof config.enabled !== "boolean"
			)
				throw new Error("Некорректные настройки");
			configSlots(config, "2026-11-02", []);
			validateFields(config.fields, {}, true);
			if (
				!Array.isArray(config.schedule) ||
				!Array.isArray(config.exceptions) ||
				config.schedule.some(
					(p) => !Number.isInteger(p.day) || p.day < 0 || p.day > 6,
				)
			)
				throw new Error("Некорректное расписание");
			for (let day = 0; day < 7; day++)
				configSlots({ ...config, exceptions: [] }, `2026-11-0${day + 1}`, []);
			for (const date of config.exceptions)
				calculateSlots({ date, weekdays: [], durationMinutes: 1, capacity: 1 });
			try {
				if (typeof config.timezone !== "string" || !config.timezone.trim())
					throw new Error("timezone required");
				new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format();
			} catch {
				throw new Error("Некорректный часовой пояс");
			}
			const result = await pool.query(
				`INSERT INTO booking_config(service_id,public_id,enabled,duration_minutes,capacity,schedule,exceptions,fields,timezone)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(service_id) DO UPDATE SET enabled=EXCLUDED.enabled,duration_minutes=EXCLUDED.duration_minutes,capacity=EXCLUDED.capacity,schedule=EXCLUDED.schedule,exceptions=EXCLUDED.exceptions,fields=EXCLUDED.fields,timezone=EXCLUDED.timezone RETURNING *`,
				[
					serviceId,
					require("node:crypto").randomUUID(),
					config.enabled,
					config.duration_minutes,
					config.capacity,
					JSON.stringify(config.schedule),
					JSON.stringify(config.exceptions),
					JSON.stringify(config.fields),
					config.timezone,
				],
			);
			return result.rows[0];
		},
		async getConfig(serviceId) {
			const r = await pool.query(
				"SELECT * FROM booking_config WHERE service_id=$1",
				[serviceId],
			);
			return r.rows[0] || null;
		},
		async getCalendar(serviceId, date) {
			const config = await this.getConfig(serviceId);
			if (!config) return null;
			const rows = await pool.query(
				`SELECT id,to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end,answers,status FROM bookings WHERE service_id=$1 AND booking_date=$2 AND status='booked' ORDER BY start_time,id`,
				[serviceId, date],
			);
			const slots = configSlots(config, date, rows.rows);
			return { slots, bookings: rows.rows };
		},
		// Administrative month overview: per day the number of slots, the number of
		// taken places and the number of free places. Client data is not included:
		// it is returned per day by getCalendar only.
		async getAdminMonth(serviceId, month) {
			const config = await this.getConfig(serviceId);
			if (!config) return null;
			const target = monthRange(month);
			const b = await pool.query(
				"SELECT to_char(booking_date,'YYYY-MM-DD') AS booking_date,to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end FROM bookings WHERE service_id=$1 AND booking_date BETWEEN $2 AND $3 AND status='booked'",
				[serviceId, target.first, target.last],
			);
			const byDate = {};
			for (const row of b.rows) {
				(byDate[row.booking_date] = byDate[row.booking_date] || []).push({
					start: row.start,
					end: row.end,
				});
			}
			const days = [];
			for (let i = 1; i <= target.days; i++) {
				const date = `${month}-${String(i).padStart(2, "0")}`;
				const slots = configSlots(config, date, byDate[date] || []);
				const capacity = slots.reduce((sum, s) => sum + s.capacity, 0);
				const booked = slots.reduce((sum, s) => sum + s.booked, 0);
				days.push({
					date,
					slots: slots.length,
					capacity,
					booked,
					free: capacity - booked,
				});
			}
			return {
				month,
				timezone: config.timezone,
				public_id: config.public_id,
				enabled: config.enabled,
				duration_minutes: config.duration_minutes,
				fields: config.fields,
				days,
			};
		},
		// All bookings of a month with client data for the administrator.
		// Only the administrator routes may use it; the public month overview
		// deliberately returns counters without client data.
		async getAdminBookings(serviceId, month) {
			const config = await this.getConfig(serviceId);
			if (!config) return null;
			const target = monthRange(month);
			const rows = await pool.query(
				"SELECT id,to_char(booking_date,'YYYY-MM-DD') AS date,to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end,answers,consented_at FROM bookings WHERE service_id=$1 AND booking_date BETWEEN $2 AND $3 AND status='booked' ORDER BY booking_date,start_time,id",
				[serviceId, target.first, target.last],
			);
			return { month, timezone: config.timezone, bookings: rows.rows };
		},
		async cancel(serviceId, bookingId) {
			const result = await pool.query(
				"UPDATE bookings SET status='cancelled' WHERE id=$1 AND service_id=$2 AND status='booked' RETURNING id",
				[bookingId, serviceId],
			);
			return result.rowCount > 0;
		},
		// Availability of every day of a month for the public calendar.
		// Returns aggregated counters only: no client data crosses this boundary.
		async getAvailability(publicId, month) {
			const r = await pool.query(
				"SELECT c.*,s.name,s.active FROM booking_config c JOIN services s ON s.id=c.service_id WHERE c.public_id=$1",
				[publicId],
			);
			const c = r.rows[0];
			if (!c || !c.active || !c.enabled) return null;
			const now = localNow(c.timezone);
			const target = month ? monthRange(month) : monthRange(monthOf(now.date));
			const b = await pool.query(
				"SELECT to_char(booking_date,'YYYY-MM-DD') AS booking_date,to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end FROM bookings WHERE service_id=$1 AND booking_date BETWEEN $2 AND $3 AND status='booked'",
				[c.service_id, target.first, target.last],
			);
			const byDate = {};
			for (const row of b.rows) {
				(byDate[row.booking_date] = byDate[row.booking_date] || []).push({
					start: row.start,
					end: row.end,
				});
			}
			const days = [];
			for (let i = 1; i <= target.days; i++) {
				const date = `${target.year}-${String(target.mon).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
				let reason = null;
				let free = 0;
				if (date < now.date) {
					reason = "past";
				} else {
					const slots = configSlots(c, date, byDate[date] || []);
					if (!slots.length) {
						reason = "closed";
					} else {
						free = slots.reduce((sum, s) => {
							const usable =
								date === now.date && s.start <= now.time ? 0 : s.available;
							return sum + usable;
						}, 0);
						if (free === 0) reason = "full";
					}
				}
				days.push({ date, available: reason === null, reason, free });
			}
			return {
				month: `${target.year}-${String(target.mon).padStart(2, "0")}`,
				timezone: c.timezone,
				name: c.name,
				description: c.description,
				days,
			};
		},
		async getPublic(publicId, date) {
			const r = await pool.query(
				"SELECT c.*,s.name,s.description,s.active FROM booking_config c JOIN services s ON s.id=c.service_id WHERE c.public_id=$1",
				[publicId],
			);
			const c = r.rows[0];
			if (!c || !c.active || !c.enabled) return null;
			const now = localNow(c.timezone);
			const b = await pool.query(
				"SELECT to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end FROM bookings WHERE service_id=$1 AND booking_date=$2 AND status='booked'",
				[c.service_id, date],
			);
			const slots = configSlots(c, date, b.rows).map((s) => ({
				...s,
				available:
					date < now.date || (date === now.date && s.start <= now.time)
						? 0
						: s.available,
			}));
			return {
				name: c.name,
				description: c.description,
				fields: c.fields,
				slots,
				timezone: c.timezone,
			};
		},
		async create(publicId, { date, start, answers, consent, agreement }, approvedConsent) {
			if (
				consent !== true ||
				agreement !== true ||
				typeof approvedConsent?.agreementText !== "string" ||
				!approvedConsent.agreementText.trim() ||
				!approvedConsent ||
				typeof approvedConsent.version !== "string" ||
				!approvedConsent.version.trim() ||
				typeof approvedConsent.text !== "string" ||
				!approvedConsent.text.trim()
			)
				throw new Error("Необходимо утверждённое согласие на обработку данных");
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				// Serializes bookings AND config changes for this service until commit.
				const r = await client.query(
					"SELECT c.*,s.active FROM booking_config c JOIN services s ON s.id=c.service_id WHERE c.public_id=$1 FOR UPDATE OF c",
					[publicId],
				);
				const c = r.rows[0];
				if (!c || !c.active || !c.enabled)
					throw new Error("Запись временно недоступна");
				const now = localNow(c.timezone);
				if (date < now.date || (date === now.date && start <= now.time))
					throw new Error("Нельзя записаться в прошедшее время");
				const b = await client.query(
					"SELECT to_char(start_time,'HH24:MI') AS start,to_char(end_time,'HH24:MI') AS end FROM bookings WHERE service_id=$1 AND booking_date=$2 AND status='booked'",
					[c.service_id, date],
				);
				const slot = configSlots(c, date, b.rows).find(
					(s) => s.start === start,
				);
				if (!slot || slot.available < 1) throw new Error("Время недоступно");
				const checked = validateFields(c.fields, answers);
				const out = await client.query(
					"INSERT INTO bookings(service_id,booking_date,start_time,end_time,answers,consent_version,consent_text,agreement_text,agreement_accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id",
					[
						c.service_id,
						date,
						start,
						slot.end,
						JSON.stringify(checked),
						approvedConsent.version,
						approvedConsent.text,
						approvedConsent.agreementText,
					],
				);
				await client.query("COMMIT");
				return { id: out.rows[0].id, date, start, end: slot.end };
			} catch (err) {
				await client.query("ROLLBACK");
				throw err;
			} finally {
				client.release();
			}
		},
	};
}
module.exports = { bookingRepository, validateFields, localNow, schema };
