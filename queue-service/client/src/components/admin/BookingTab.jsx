import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../api";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
	"январь",
	"февраль",
	"март",
	"апрель",
	"май",
	"июнь",
	"июль",
	"август",
	"сентябрь",
	"октябрь",
	"ноябрь",
	"декабрь",
];
const control = "rounded-lg border border-gray-300 px-3 py-2 text-sm";

function monthTitle(month) {
	const [year, mon] = month.split("-").map(Number);
	return `${MONTHS[mon - 1]} ${year}`;
}

function shiftMonth(month, delta) {
	const [year, mon] = month.split("-").map(Number);
	const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// The service keeps its own time zone, so "today" is counted in it.
function todayIn(timezone) {
	if (!timezone) return new Date().toLocaleDateString("en-CA");
	try {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date());
	} catch {
		return new Date().toLocaleDateString("en-CA");
	}
}

function formatDate(date) {
	return new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

// Monday-first grid: the cells before the first day of the month are empty.
function buildGrid(days) {
	const cells = [];
	if (!days.length) return cells;
	const first = new Date(`${days[0].date}T00:00:00Z`);
	const offset = (first.getUTCDay() + 6) % 7;
	for (let i = 0; i < offset; i++) cells.push(null);
	for (const day of days) cells.push(day);
	while (cells.length % 7 !== 0) cells.push(null);
	return cells;
}

export default function BookingTab() {
	const [services, setServices] = useState([]);
	const [serviceId, setServiceId] = useState(null);
	const [month, setMonth] = useState(currentMonth());
	const [overview, setOverview] = useState(null);
	const [selectedDate, setSelectedDate] = useState(null);
	const [day, setDay] = useState(null);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	// The day is set to today once the time zone of the service is known.
	const needsToday = useRef(true);

	async function request(url, options) {
		const res = await apiFetch(url, options);
		if (!res) throw new Error("Необходима авторизация");
		const content = res.headers.get("content-type") || "";
		if (!content.includes("application/json"))
			throw new Error("Модуль записи пока не подключён");
		const result = await res.json();
		if (!res.ok) throw new Error(result.error || "Не удалось выполнить запрос");
		return result;
	}

	useEffect(() => {
		apiFetch("/api/booking/services")
			.then((r) => (r ? r.json() : null))
			.then((d) => {
				if (!d) return;
				// Only services with the booking channel prepared are listed.
				const list = (d.services || []).filter(
					(s) => s.booking_enabled || s.public_id,
				);
				setServices(list);
				setServiceId((current) => current ?? list[0]?.id ?? null);
			})
			.catch(() => setError("Не удалось загрузить список услуг"));
	}, []);

	// A new service means a new day: the current day of its time zone.
	useEffect(() => {
		if (!serviceId) return;
		setSelectedDate(null);
		setMonth(currentMonth());
		needsToday.current = true;
	}, [serviceId]);

	useEffect(() => {
		if (!serviceId) return;
		let active = true;
		setError("");
		setOverview(null);
		request(`/api/booking/services/${serviceId}/month?month=${month}`)
			.then((result) => {
				if (!active) return;
				setOverview(result);
				if (!needsToday.current) return;
				needsToday.current = false;
				const today = todayIn(result.timezone);
				setSelectedDate(today);
				if (today.slice(0, 7) !== month) setMonth(today.slice(0, 7));
			})
			.catch((e) => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
		};
	}, [serviceId, month]);

	useEffect(() => {
		if (!serviceId || !selectedDate) {
			setDay(null);
			return;
		}
		let active = true;
		setError("");
		request(
			`/api/booking/services/${serviceId}/calendar?date=${encodeURIComponent(selectedDate)}`,
		)
			.then((result) => {
				if (active) setDay(result);
			})
			.catch((e) => {
				if (active) {
					setDay(null);
					setError(e.message);
				}
			});
		return () => {
			active = false;
		};
	}, [serviceId, selectedDate]);

	async function cancel(bookingId) {
		if (!window.confirm("Отменить эту запись?")) return;
		setError("");
		setNotice("");
		try {
			await request(
				`/api/booking/services/${serviceId}/bookings/${bookingId}/cancel`,
				{ method: "POST" },
			);
			setNotice("Запись отменена");
			const [dayResult, monthResult] = await Promise.all([
				selectedDate
					? request(
							`/api/booking/services/${serviceId}/calendar?date=${encodeURIComponent(selectedDate)}`,
						)
					: null,
				request(`/api/booking/services/${serviceId}/month?month=${month}`),
			]);
			if (dayResult) setDay(dayResult);
			setOverview(monthResult);
		} catch (e) {
			setError(e.message);
		}
	}

	function pickDate(date) {
		setSelectedDate(date);
		setMonth(date.slice(0, 7));
		setCalendarOpen(false);
	}

	function goToToday() {
		const today = todayIn(overview?.timezone);
		pickDate(today);
	}

	const cells = useMemo(() => buildGrid(overview?.days || []), [overview]);
	const today = todayIn(overview?.timezone);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-end gap-3">
				<label className="text-sm">
					<span className="mb-1 block font-medium">Услуга</span>
					<select
						className={control}
						value={serviceId ?? ""}
						onChange={(e) => setServiceId(Number(e.target.value))}
					>
						{services.length === 0 && <option value="">—</option>}
						{services.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
					onClick={() => setCalendarOpen(true)}
				>
					{selectedDate ? formatDate(selectedDate) : "Выбрать дату"}
					{selectedDate === today && (
						<span className="ml-2 text-xs text-gray-500">сегодня</span>
					)}
				</button>
			</div>

			{error && (
				<p
					role="alert"
					className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
				>
					{error}
				</p>
			)}
			{notice && (
				<p role="status" className="text-sm text-green-700">
					{notice}
				</p>
			)}

			<section className="rounded-2xl bg-white p-4 shadow-sm">
				<h2 className="text-lg font-bold">
					{selectedDate ? formatDate(selectedDate) : "Выберите дату"}
				</h2>
				{!selectedDate && (
					<p className="mt-2 text-sm text-gray-500">
						Нажмите кнопку с датой рядом с выбором услуги — откроется календарь.
					</p>
				)}
				{selectedDate && !day && (
					<p className="mt-2 text-sm text-gray-500">Загрузка…</p>
				)}
				{selectedDate && day && (
					<div className="mt-3 space-y-3">
						{day.slots.length === 0 && (
							<p className="text-sm text-gray-500">
								По расписанию на эту дату слотов нет.
							</p>
						)}
						{day.slots.map((slot) => {
							const inSlot = day.bookings.filter(
								(b) => b.start < slot.end && b.end > slot.start,
							);
							return (
								<div
									key={slot.start}
									className={`rounded-xl border p-3 text-sm ${
										slot.available > 0
											? "border-emerald-300 bg-emerald-50"
											: "border-rose-300 bg-rose-50"
									}`}
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<strong>
											{slot.start}–{slot.end}
										</strong>
										<span className="text-xs text-gray-600">
											занято {slot.booked} из {slot.capacity}
										</span>
									</div>
									{inSlot.length === 0 && (
										<p className="mt-1 text-xs text-gray-500">Записей нет</p>
									)}
									{inSlot.map((b) => (
										<div
											key={b.id}
											className="mt-2 rounded-lg bg-white p-2 text-xs shadow-sm"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<span>
													{Object.values(b.answers || {})
														.map((a) => `${a.label}: ${a.value}`)
														.join(" · ") || "данные не указаны"}
												</span>
												<button
													type="button"
													onClick={() => cancel(b.id)}
													className="text-red-700 underline"
												>
													Отменить
												</button>
											</div>
										</div>
									))}
								</div>
							);
						})}
						{day.bookings.filter(
							(b) =>
								!day.slots.some((s) => b.start < s.end && b.end > s.start),
						).length > 0 && (
							<p className="text-xs text-amber-700">
								Есть записи вне текущего расписания — они показаны ниже.
							</p>
						)}
						{day.bookings.length > 0 && (
							<div>
								<h3 className="pt-1 font-semibold">Все записи на дату</h3>
								<div className="mt-2 space-y-2">
									{day.bookings.map((b) => (
										<div
											key={b.id}
											className="rounded-lg border border-gray-200 p-2 text-xs"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<span>
													<b>
														{b.start}–{b.end}
													</b>{" "}
													{Object.values(b.answers || {})
														.map((a) => `${a.label}: ${a.value}`)
														.join(" · ") || "данные не указаны"}
												</span>
												<button
													type="button"
													onClick={() => cancel(b.id)}
													className="text-red-700 underline"
												>
													Отменить
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}
			</section>

			{calendarOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
					onClick={() => setCalendarOpen(false)}
				>
					<div
						className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label="Выбор даты"
					>
						<div className="mb-4 flex items-center justify-between">
							<button
								type="button"
								className="rounded-lg px-2 py-1 text-lg"
								onClick={() => setMonth(shiftMonth(month, -1))}
								aria-label="Предыдущий месяц"
							>
								←
							</button>
							<h3 className="text-lg font-bold capitalize">
								{monthTitle(month)}
							</h3>
							<button
								type="button"
								className="rounded-lg px-2 py-1 text-lg"
								onClick={() => setMonth(shiftMonth(month, 1))}
								aria-label="Следующий месяц"
							>
								→
							</button>
						</div>

						{!overview ? (
							<p className="text-sm text-gray-500">
								{error ? "Календарь недоступен." : "Загрузка…"}
							</p>
						) : (
							<>
								<div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400">
									{WEEKDAYS.map((w) => (
										<div key={w}>{w}</div>
									))}
								</div>
								<div className="mt-1 grid grid-cols-7 gap-1">
									{cells.map((day1, index) =>
										day1 ? (
											<button
												key={day1.date}
												type="button"
												onClick={() => pickDate(day1.date)}
												className={`rounded-lg border p-1.5 text-left text-xs transition ${
													selectedDate === day1.date
														? "border-blue-600 bg-blue-50"
														: day1.booked > 0
															? "border-amber-300 bg-amber-50 hover:bg-amber-100"
															: day1.slots > 0
																? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
																: "border-gray-200 bg-gray-50 text-gray-400"
												}`}
											>
												<span className="block text-sm font-bold">
													{Number(day1.date.slice(-2))}
												</span>
												<span className="block">
													{day1.booked > 0
														? `записей: ${day1.booked}`
														: day1.slots > 0
															? "свободно"
															: "нет записи"}
												</span>
												{day1.slots > 0 && (
													<span className="block text-gray-500">
														мест: {day1.free}/{day1.capacity}
													</span>
												)}
											</button>
										) : (
											<div key={`empty-${index}`} />
										),
									)}
								</div>
								<div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
									<span className="flex items-center gap-1.5">
										<span className="inline-block h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-300" />
										есть свободные места
									</span>
									<span className="flex items-center gap-1.5">
										<span className="inline-block h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-300" />
										есть записи
									</span>
									<span className="flex items-center gap-1.5">
										<span className="inline-block h-3 w-3 rounded bg-gray-100 ring-1 ring-gray-300" />
										запись не ведётся
									</span>
								</div>
							</>
						)}

						<div className="mt-4 flex justify-between">
							<button
								type="button"
								className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
								onClick={goToToday}
							>
								Сегодня
							</button>
							<button
								type="button"
								className="rounded-lg px-4 py-2 text-sm text-gray-500"
								onClick={() => setCalendarOpen(false)}
							>
								Закрыть
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
