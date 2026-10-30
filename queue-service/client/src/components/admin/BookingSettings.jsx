import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { defaultBookingConfig } from "./bookingDefaults";

const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const initial = defaultBookingConfig();
const control = "rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function BookingSettings({ service, onClose }) {
	const [config, setConfig] = useState(null),
		[calendar, setCalendar] = useState(null),
		[date, setDate] = useState(new Date().toLocaleDateString("en-CA")),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[loading, setLoading] = useState(true);
	const base = `/api/booking/services/${service.id}`;
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
		let active = true;
		setLoading(true);
		request(`${base}/config`)
			.then((c) => {
				if (active) setConfig(c || initial);
			})
			.catch((e) => {
				if (active) setError(e.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [service.id]);
	async function save() {
		setError("");
		setNotice("");
		try {
			const result = await request(`${base}/config`, {
				method: "PUT",
				body: JSON.stringify(config),
			});
			setConfig(result);
			setNotice("Настройки сохранены");
		} catch (e) {
			setError(e.message);
		}
	}
	async function loadCalendar() {
		setError("");
		try {
			setCalendar(
				await request(`${base}/calendar?date=${encodeURIComponent(date)}`),
			);
		} catch (e) {
			setCalendar(null);
			setError(e.message);
		}
	}
	async function cancel(id) {
		if (!window.confirm("Отменить эту запись?")) return;
		try {
			await request(`${base}/bookings/${id}/cancel`, { method: "POST" });
			await loadCalendar();
		} catch (e) {
			setError(e.message);
		}
	}
	function setDay(day, enabled) {
		setConfig((c) => ({
			...c,
			schedule: enabled
				? [...c.schedule, { day, start: "09:00", end: "18:00" }]
				: c.schedule.filter((p) => p.day !== day),
		}));
	}
	function setPeriod(day, key, value) {
		setConfig((c) => ({
			...c,
			schedule: c.schedule.map((p) =>
				p.day === day ? { ...p, [key]: value } : p,
			),
		}));
	}
	function addField() {
		setConfig((c) => ({
			...c,
			fields: [
				...c.fields,
				{
					id: `field_${crypto.randomUUID().replaceAll("-", "")}`,
					label: "Новое поле",
					type: "text",
					required: true,
				},
			],
		}));
	}
	const url = config?.public_id
		? `${window.location.origin}/booking/${config.public_id}`
		: "";
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
			role="dialog"
			aria-modal="true"
			aria-label={`Запись: ${service.name}`}
		>
			<div className="max-h-[95vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-xl">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-xl font-bold">Запись: {service.name}</h2>
						<p className="mt-1 text-sm text-gray-500">
							Посты ограничивают только предварительные записи; талоны очереди
							их не занимают.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-2 py-1 text-xl"
						aria-label="Закрыть"
					>
						×
					</button>
				</div>
				{loading && <p className="mt-5">Загрузка…</p>}
				{error && (
					<p
						role="alert"
						className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
					>
						{error}
					</p>
				)}
				{notice && (
					<p role="status" className="mt-4 text-sm text-green-700">
						{notice}
					</p>
				)}
				{config && (
					<div className="mt-5 space-y-6">
						<label className="flex gap-2 font-semibold">
							<input
								type="checkbox"
								checked={config.enabled}
								onChange={(e) =>
									setConfig({ ...config, enabled: e.target.checked })
								}
							/>{" "}
							Канал «Запись»
						</label>
						<div className="grid gap-4 sm:grid-cols-3">
							<label className="text-sm">
								Длительность, минут
								<input
									className={`${control} mt-1 block w-full`}
									type="number"
									min="1"
									max="1440"
									value={config.duration_minutes}
									onChange={(e) =>
										setConfig({
											...config,
											duration_minutes: Number(e.target.value),
										})
									}
								/>
							</label>
							<label className="text-sm">
								Количество постов
								<input
									className={`${control} mt-1 block w-full`}
									type="number"
									min="1"
									max="100"
									value={config.capacity}
									onChange={(e) =>
										setConfig({ ...config, capacity: Number(e.target.value) })
									}
								/>
							</label>
							<label className="text-sm">
								Часовой пояс
								<input
									className={`${control} mt-1 block w-full`}
									value={config.timezone}
									onChange={(e) =>
										setConfig({ ...config, timezone: e.target.value })
									}
								/>
							</label>
						</div>
						<section>
							<h3 className="font-semibold">Рабочие дни</h3>
							<div className="mt-2 space-y-2">
								{weekdays.map((label, day) => {
									const p = config.schedule.find((x) => x.day === day);
									return (
										<div
											key={label}
											className="flex flex-wrap items-center gap-3"
										>
											<label className="w-16 text-sm">
												<input
													type="checkbox"
													checked={!!p}
													onChange={(e) => setDay(day, e.target.checked)}
												/>{" "}
												{label}
											</label>
											{p && (
												<>
													<input
														aria-label={`${label} начало`}
														type="time"
														className={control}
														value={p.start}
														onChange={(e) =>
															setPeriod(day, "start", e.target.value)
														}
													/>
													<span>—</span>
													<input
														aria-label={`${label} конец`}
														type="time"
														className={control}
														value={p.end}
														onChange={(e) =>
															setPeriod(day, "end", e.target.value)
														}
													/>
												</>
											)}
										</div>
									);
								})}
							</div>
						</section>
						<label className="block text-sm font-semibold">
							Выходные и исключения{" "}
							<span className="font-normal text-gray-500">
								— даты через запятую, ГГГГ-ММ-ДД
							</span>
							<input
								className={`${control} mt-2 block w-full font-normal`}
								value={config.exceptions.join(", ")}
								onChange={(e) =>
									setConfig({
										...config,
										exceptions: e.target.value.split(",").map((x) => x.trim()),
									})
								}
								onBlur={() =>
									setConfig((c) => ({
										...c,
										exceptions: c.exceptions.filter(Boolean),
									}))
								}
							/>
						</label>
						<section>
							<div className="flex justify-between">
								<h3 className="font-semibold">Поля клиента</h3>
								<button
									type="button"
									onClick={addField}
									className="text-sm text-blue-600"
								>
									+ Добавить поле
								</button>
							</div>
							<div className="mt-2 space-y-2">
								{config.fields.map((field, index) => (
									<div key={field.id} className="flex flex-wrap gap-2">
										<input
											aria-label="Название поля"
											className={`${control} flex-1`}
											value={field.label}
											onChange={(e) =>
												setConfig((c) => ({
													...c,
													fields: c.fields.map((f, i) =>
														i === index ? { ...f, label: e.target.value } : f,
													),
												}))
											}
										/>
										<select
											aria-label="Тип поля"
											className={control}
											value={field.type}
											onChange={(e) =>
												setConfig((c) => ({
													...c,
													fields: c.fields.map((f, i) =>
														i === index ? { ...f, type: e.target.value } : f,
													),
												}))
											}
										>
											{[
												["text", "Текст"],
												["phone", "Телефон"],
												["email", "Email"],
												["number", "Число"],
												["date", "Дата"],
												["textarea", "Большой текст"],
											].map(([v, n]) => (
												<option key={v} value={v}>
													{n}
												</option>
											))}
										</select>
										<label className="flex items-center gap-1 text-sm">
											<input
												type="checkbox"
												checked={!!field.required}
												onChange={(e) =>
													setConfig((c) => ({
														...c,
														fields: c.fields.map((f, i) =>
															i === index
																? { ...f, required: e.target.checked }
																: f,
														),
													}))
												}
											/>{" "}
											Обязательное
										</label>
										<button
											type="button"
											onClick={() =>
												setConfig((c) => ({
													...c,
													fields: c.fields.filter((_, i) => i !== index),
												}))
											}
											className="text-red-600"
										>
											Удалить
										</button>
									</div>
								))}
							</div>
						</section>
						<button
							type="button"
							onClick={save}
							className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white"
						>
							Сохранить настройки
						</button>
						{url && (
							<section className="space-y-2 rounded-xl bg-gray-50 p-4">
								<h3 className="font-semibold">Постоянный виджет</h3>
								<p className="text-xs text-gray-500">
									Ссылка сохранится при отключении записи.
								</p>
								<input
									readOnly
									aria-label="Ссылка на виджет"
									className={`${control} w-full`}
									value={url}
								/>
								<textarea
									readOnly
									aria-label="Код встраивания"
									className={`${control} w-full`}
									value={`<iframe src="${url}" title="Предварительная запись" width="100%" height="760" style="border:0" loading="lazy"></iframe>`}
								/>
							</section>
						)}
<section>
<h3 className="font-semibold">Календарь</h3><div className="mt-2 flex flex-wrap gap-2"><input type="date" className={control} value={date} onChange={e=>{setDate(e.target.value);setCalendar(null)}}/><button type="button" className="rounded-lg bg-gray-100 px-4 py-2 text-sm" onClick={loadCalendar}>Показать</button></div>
{calendar && <div className="mt-3 space-y-2">{calendar.slots.length===0&&<p className="text-sm text-gray-500">Интервалов по текущему расписанию нет.</p>}{calendar.slots.map(slot=><div key={slot.start} className={`rounded-lg p-3 text-sm ${slot.available?'bg-green-50':'bg-red-50'}`}><strong>{slot.start}–{slot.end}</strong> · занято {slot.booked} из {slot.capacity}</div>)}<h4 className="pt-3 font-semibold">Записи на выбранную дату</h4>{calendar.bookings.length===0&&<p className="text-sm text-gray-500">Записей нет.</p>}{calendar.bookings.map(b=><div key={b.id} className="rounded-lg bg-red-50 p-3 text-sm"><strong>{b.start}–{b.end}</strong>{!calendar.slots.some(s=>b.start<s.end&&b.end>s.start)&&<span className="ml-2 text-amber-700">Вне текущего расписания</span>}<div className="mt-2">{Object.values(b.answers).map((a,i)=><span key={i} className="mr-3">{a.label}: {a.value}</span>)}<button type="button" onClick={()=>cancel(b.id)} className="text-red-700 underline">Отменить запись</button></div></div>)}</div>}
</section>
					</div>
				)}
			</div>
		</div>
	);
}
