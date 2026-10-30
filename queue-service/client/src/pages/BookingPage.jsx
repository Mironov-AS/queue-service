import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
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
const REASONS = {
	past: "Дата уже прошла",
	closed: "В этот день приём не ведётся",
	full: "Все места заняты",
};

function monthTitle(month) {
	const [year, m] = month.split("-");
	return `${MONTH_NAMES[Number(m) - 1]} ${year}`;
}

// Monday-first grid: how many empty cells precede the first day of the month.
function leadingBlanks(month) {
	const [year, m] = month.split("-").map(Number);
	return (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
}

function shiftMonth(month, delta) {
	const [year, m] = month.split("-").map(Number);
	const date = new Date(Date.UTC(year, m - 1 + delta, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Current month in the service time zone, so the visitor cannot browse back
// into months that are already behind the queue's local calendar.
function currentMonth(timezone) {
	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
		}).formatToParts(new Date());
		const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
		return `${o.year}-${o.month}`;
	} catch {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
	}
}

// A widget link may carry ?date=YYYY-MM-DD or ?month=YYYY-MM so an embedder
// can open the calendar on a specific day or month. Invalid values are ignored.
function linkParams() {
	const params = new URLSearchParams(window.location.search);
	const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "")
		? params.get("date")
		: null;
	const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "")
		? params.get("month")
		: date
			? date.slice(0, 7)
			: null;
	return { date, month };
}

export default function BookingPage() {
	const { publicId } = useParams();
	const [month, setMonth] = useState(null);
	const [days, setDays] = useState([]);
	const [timezone, setTimezone] = useState("");
	const [consent, setConsent] = useState(null);
	const [fields, setFields] = useState([]);
	const [service, setService] = useState({ name: "", description: "" });
	const [selectedDate, setSelectedDate] = useState(null);
	const [slots, setSlots] = useState([]);
	const [slot, setSlot] = useState("");
	const [answers, setAnswers] = useState({});
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [sending, setSending] = useState(false);
	const [receipt, setReceipt] = useState(null);
	const [revision, setRevision] = useState(0);

	const loadMonth = async (target) => {
		setLoading(true);
		setError("");
		try {
			const query = target ? `?month=${encodeURIComponent(target)}` : "";
			const response = await fetch(
				`/api/booking/public/${encodeURIComponent(publicId)}/month${query}`,
			);
			if (!response.ok) {
				if (response.status === 404)
					throw new Error("Запись на эту услугу временно недоступна.");
				throw new Error("Не удалось загрузить календарь. Попробуйте ещё раз.");
			}
			const result = await response.json();
			setMonth(result.month);
			setDays(result.days || []);
			setTimezone(result.timezone || "");
			setConsent(result.consent || null);
			setService({
				name: result.name || "",
				description: result.description || "",
			});
			setSelectedDate(null);
			setSlots([]);
			setSlot("");
			setFields([]);
			setReceipt(null);
		} catch (err) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		let active = true;
		const requested = linkParams();
		setLoading(true);
		const query = requested.month
			? `?month=${encodeURIComponent(requested.month)}`
			: "";
		fetch(
			`/api/booking/public/${encodeURIComponent(publicId)}/month${query}`,
		)
			.then(async (response) => {
				if (!response.ok) {
					if (response.status === 404)
						throw new Error("Запись на эту услугу временно недоступна.");
					throw new Error("Не удалось загрузить календарь. Попробуйте ещё раз.");
				}
				return response.json();
			})
			.then((result) => {
				if (!active) return;
				setMonth(result.month);
				setDays(result.days || []);
				setTimezone(result.timezone || "");
				setConsent(result.consent || null);
				setService({
					name: result.name || "",
					description: result.description || "",
				});
				if (requested.date) {
					const day = (result.days || []).find((d) => d.date === requested.date);
					if (day && day.available) chooseDate(requested.date);
				}
			})
			.catch((err) => {
				if (active) setError(err.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [publicId, revision]);

	const chooseDate = async (date) => {
		setSelectedDate(date);
		setSlot("");
		setSlots([]);
		setError("");
		setReceipt(null);
		setLoading(true);
		try {
			const response = await fetch(
				`/api/booking/public/${encodeURIComponent(publicId)}?date=${encodeURIComponent(date)}`,
			);
			if (!response.ok) {
				if (response.status === 404)
					throw new Error("Запись на эту услугу временно недоступна.");
				throw new Error("Не удалось загрузить расписание. Попробуйте ещё раз.");
			}
			const result = await response.json();
			setSlots(result.slots || []);
			setFields(result.fields || []);
			setConsent(result.consent || consent);
		} catch (err) {
			setError(err.message);
		} finally {
			setLoading(false);
		}
	};

	const submit = async (event) => {
		event.preventDefault();
		if (sending || !slot || !consent?.version || !selectedDate) return;
		setSending(true);
		setError("");
		try {
			const response = await fetch(
				`/api/booking/public/${encodeURIComponent(publicId)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						date: selectedDate,
						start: slot,
						answers,
						consent: true,
						consentVersion: consent.version,
					}),
				},
			);
			const result = await response.json();
			if (!response.ok)
				throw new Error(result.error || "Не удалось создать запись.");
			setReceipt(result);
		} catch (err) {
			setError(err.message || "Не удалось создать запись.");
		} finally {
			setSending(false);
		}
	};

	const cells = useMemo(() => {
		if (!month) return [];
		const blanks = leadingBlanks(month);
		const items = [];
		for (let i = 0; i < blanks; i++) items.push(null);
		for (const day of days) items.push(day);
		return items;
	}, [month, days]);

	const minMonth = currentMonth(timezone);
	const canGoBack = month && month > minMonth;

	return (
		<main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800">
			<div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-lg sm:p-8">
				<p className="text-sm font-bold uppercase tracking-wider text-blue-600">
					Предварительная запись
				</p>
				<h1 className="mt-2 text-2xl font-black">
					{service.name || "Запись на услугу"}
				</h1>
				{service.description && (
					<p className="mt-2 text-slate-500">{service.description}</p>
				)}

				{receipt ? (
					<section
						className="mt-6 rounded-2xl bg-emerald-50 p-5 text-emerald-900"
						role="status"
					>
						<h2 className="text-lg font-bold">Вы записаны</h2>
						<p className="mt-2">
							Дата: {receipt.date}, время: {receipt.start}–{receipt.end}
						</p>
					</section>
				) : (
					<>
						{loading && !month && (
							<p className="mt-5 text-slate-500" role="status">
								Загружаем календарь…
							</p>
						)}
						{error && (
							<div
								className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
								role="alert"
							>
								{error}
								<button
									type="button"
									onClick={() => setRevision((n) => n + 1)}
									className="ml-2 font-bold underline"
								>
									Повторить
								</button>
							</div>
						)}

						{month && !selectedDate && (
							<section className="mt-6">
								<div className="flex items-center justify-between">
									<button
										type="button"
										onClick={() => loadMonth(shiftMonth(month, -1))}
										disabled={!canGoBack}
										className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-bold disabled:opacity-30"
										aria-label="Предыдущий месяц"
									>
										←
									</button>
									<h2 className="text-lg font-bold capitalize">
										{monthTitle(month)}
									</h2>
									<button
										type="button"
										onClick={() => loadMonth(shiftMonth(month, 1))}
										className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-bold"
										aria-label="Следующий месяц"
									>
										→
									</button>
								</div>

								<div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
									{WEEKDAYS.map((w) => (
										<div key={w}>{w}</div>
									))}
								</div>
								<div className="mt-1 grid grid-cols-7 gap-1">
									{cells.map((day, index) =>
										day === null ? (
											<div key={`blank-${index}`} />
										) : (
											<button
												key={day.date}
												type="button"
												disabled={!day.available}
												title={
													day.available
														? `Свободных мест: ${day.free}`
														: REASONS[day.reason] || "Запись недоступна"
												}
												onClick={() => chooseDate(day.date)}
												className={`rounded-xl border p-2 text-sm font-semibold transition ${
													day.available
														? "border-emerald-400 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
														: "cursor-not-allowed border-rose-300 bg-rose-100 text-rose-400"
												}`}
											>
												{Number(day.date.slice(-2))}
											</button>
										),
									)}
								</div>
								<div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
									<span className="flex items-center gap-1.5">
										<span className="inline-block h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-400" />
										есть свободные места
									</span>
									<span className="flex items-center gap-1.5">
										<span className="inline-block h-3 w-3 rounded bg-rose-100 ring-1 ring-rose-300" />
										запись недоступна
									</span>
								</div>
							</section>
						)}

						{selectedDate && (
							<section className="mt-6">
								<button
									type="button"
									onClick={() => {
										setSelectedDate(null);
										setSlots([]);
										setSlot("");
										setError("");
									}}
									className="text-sm font-semibold text-blue-700 underline"
								>
									← К выбору даты
								</button>
								<h2 className="mt-2 text-lg font-bold">
									{new Date(`${selectedDate}T00:00:00`).toLocaleDateString(
										"ru-RU",
										{ day: "numeric", month: "long", year: "numeric" },
									)}
									{timezone && (
										<span className="ml-2 text-sm font-normal text-slate-500">
											({timezone})
										</span>
									)}
								</h2>

								{loading && (
									<p className="mt-4 text-slate-500" role="status">
										Загружаем расписание…
									</p>
								)}
								{!loading && slots.length === 0 && (
									<p className="mt-4 text-sm text-slate-500">
										На эту дату свободных интервалов нет.
									</p>
								)}
								{slots.length > 0 && (
									<>
										<fieldset className="mt-4">
											<legend className="text-sm font-semibold">
												Выберите время
											</legend>
											<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
												{slots.map((s) => (
													<button
														type="button"
														key={s.start}
														disabled={s.available < 1}
														onClick={() => setSlot(s.start)}
														aria-pressed={slot === s.start}
														className={`rounded-xl border p-3 text-left text-sm ${s.available < 1 ? "cursor-not-allowed border-rose-300 bg-rose-100 text-rose-500" : slot === s.start ? "border-blue-600 bg-blue-100 text-blue-900" : "border-emerald-400 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"}`}
													>
														<strong>{s.start}</strong>
														<span className="mt-1 block text-xs">
															{s.available
																? `Свободно: ${s.available} из ${s.capacity}`
																: "Занято"}
														</span>
													</button>
												))}
											</div>
										</fieldset>

										{slot && (
											<form onSubmit={submit} className="mt-6 space-y-5">
												{fields.map((field) => (
													<label key={field.id} className="block text-sm font-semibold">
														{field.label}
														{field.required && " *"}
														{field.type === "textarea" ? (
															<textarea
																className="mt-2 block w-full rounded-xl border border-slate-300 p-3 font-normal"
																required={!!field.required}
																maxLength={1000}
																value={answers[field.id] || ""}
																onChange={(e) =>
																	setAnswers({ ...answers, [field.id]: e.target.value })
																}
															/>
														) : (
															<input
																className="mt-2 block w-full rounded-xl border border-slate-300 p-3 font-normal"
																type={field.type === "phone" ? "tel" : field.type}
																required={!!field.required}
																maxLength={1000}
																value={answers[field.id] || ""}
																onChange={(e) =>
																	setAnswers({ ...answers, [field.id]: e.target.value })
																}
															/>
														)}
													</label>
												))}
												{consent?.text &&
												consent?.policyUrl &&
												consent?.consentUrl ? (
													<div className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
														<p>{consent.text}</p>
														<p className="mt-2">
															Нажимая «Записаться», вы соглашаетесь на обработку
															персональных данных. Ознакомьтесь с{" "}
															<a
																href={consent.policyUrl}
																target="_blank"
																rel="noreferrer"
																className="text-blue-700 underline"
															>
																политикой обработки персональных данных
															</a>{" "}
															и{" "}
															<a
																href={consent.consentUrl}
																target="_blank"
																rel="noreferrer"
																className="text-blue-700 underline"
															>
																согласием
															</a>
															.
														</p>
													</div>
												) : (
													<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
														Запись временно недоступна: документы о персональных данных
														не настроены.
													</p>
												)}
												<button
													type="submit"
													disabled={
														!slot ||
														sending ||
														!consent?.policyUrl ||
														!consent?.consentUrl
													}
													className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
												>
													{sending ? "Отправляем…" : "Записаться"}
												</button>
											</form>
										)}
									</>
								)}
							</section>
						)}
					</>
				)}
			</div>
		</main>
	);
}
