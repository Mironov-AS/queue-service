import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { defaultBookingConfig } from "./bookingDefaults";
import QueueFieldsEditor from "./QueueFieldsEditor";
import { Icon, P } from "./shared";

// Модуль записи подключается отдельно; пока он выключен, вкладка «Запись»
// внутри услуги не показывается.
const bookingEnabled = import.meta.env.VITE_BOOKING_ENABLED === "true";

const WIDGET_ORIGIN = "https://app-341b7baafda02d517aa619d3f4d77626.promto.site";

const WEEKDAYS = [
	{ day: 0, label: "Воскресенье" },
	{ day: 1, label: "Понедельник" },
	{ day: 2, label: "Вторник" },
	{ day: 3, label: "Среда" },
	{ day: 4, label: "Четверг" },
	{ day: 5, label: "Пятница" },
	{ day: 6, label: "Суббота" },
];

const BOOKING_FIELD_TYPES = [
	{ value: "text", label: "Текст" },
	{ value: "phone", label: "Телефон" },
	{ value: "email", label: "Email" },
	{ value: "number", label: "Число" },
	{ value: "date", label: "Дата" },
	{ value: "textarea", label: "Большой текст" },
];

const input =
	"w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function SectionTitle({ title, hint }) {
	return (
		<div className="mb-3">
			<h3 className="text-sm font-bold text-gray-800">{title}</h3>
			{hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
		</div>
	);
}

// ─── Service Editor Modal ─────────────────────────────────────────────────────

export default function ServiceEditorModal({
	service,
	channels,
	onClose,
	onSaved,
}) {
	const isNew = !service;
	const [savedId, setSavedId] = useState(service?.id || null);
	const [form, setForm] = useState({
		name: service?.name || "",
		description: service?.description || "",
		avg_duration_minutes: service?.avg_duration_minutes ?? 5,
		priority: service?.priority ?? 0,
		daily_limit: service?.daily_limit ?? "",
		is_default: !!service?.is_default,
	});
	const [queueOn, setQueueOn] = useState(service ? !!service.enabled : true);
	const [bookingOn, setBookingOn] = useState(
		!!(service && channels?.[service.id]?.booking_enabled),
	);
	// Состояние каналов справочника может прийти позже окна, поэтому при
	// загрузке настроек записи ориентируемся на серверную конфигурацию услуги.
	const channelsRef = useRef(channels);
	channelsRef.current = channels;
	const [config, setConfig] = useState(null);
	const [tab, setTab] = useState("main");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [saving, setSaving] = useState(false);
	const [loadingConfig, setLoadingConfig] = useState(bookingEnabled);

	// Настройки записи живут в модуле записи, поэтому подгружаем их отдельно.
	useEffect(() => {
		if (!bookingEnabled || !service?.id) {
			setConfig(defaultBookingConfig());
			setLoadingConfig(false);
			return;
		}
		let active = true;
		(async () => {
			try {
				const res = await apiFetch(
					`/api/booking/services/${service.id}/config`,
				);
				if (!res || !res.ok) throw new Error("Настройки записи недоступны");
				const row = await res.json();
				if (!active) return;
				setConfig(row ? { ...defaultBookingConfig(), ...row } : null);
				setBookingOn(
					row
						? row.enabled === true
						: !!channelsRef.current?.[service.id]?.booking_enabled,
				);
			} catch (e) {
				if (active) setError(e.message);
			} finally {
				if (active) setLoadingConfig(false);
			}
		})();
		return () => {
			active = false;
		};
	}, [service?.id]);

	const tabs = useMemo(() => {
		const list = [{ id: "main", label: "Основное" }];
		if (queueOn) list.push({ id: "queue", label: "Очередь" });
		if (bookingEnabled && bookingOn)
			list.push({ id: "booking", label: "Запись" });
		return list;
	}, [queueOn, bookingOn]);

	useEffect(() => {
		if (!tabs.some((t) => t.id === tab)) setTab("main");
	}, [tabs, tab]);

	const widgetUrl = config?.public_id ? `${WIDGET_ORIGIN}/booking/${config.public_id}` : "";
	const embedCode = config?.public_id ? `<iframe src="${widgetUrl}" title="Предварительная запись" style="width:100%;border:0;min-height:600px" loading="lazy" id="booking-widget-${config.public_id}"></iframe>\n<script>\n(function(){var frame=document.getElementById("booking-widget-${config.public_id}");window.addEventListener("message",function(e){if(e.origin!=="${WIDGET_ORIGIN}"||e.source!==frame.contentWindow||!e.data||e.data.type!=="booking-widget-height"||e.data.publicId!=="${config.public_id}")return;var h=Number(e.data.height);if(Number.isFinite(h)&&h>=200&&h<=20000)frame.style.height=h+"px";});})();\n</script>` : "";

	const setConfigValue = (patch) =>
		setConfig((c) => ({ ...(c || defaultBookingConfig()), ...patch }));

	const setDay = (day, enabled) => {
		setConfigValue({
			schedule: enabled
				? [...(config?.schedule || []), { day, start: "09:00", end: "18:00" }]
				: (config?.schedule || []).filter((p) => p.day !== day),
		});
	};

	const setPeriod = (day, key, value) => {
		setConfigValue({
			schedule: (config?.schedule || []).map((p) =>
				p.day === day ? { ...p, [key]: value } : p,
			),
		});
	};

	const addBookingField = () =>
		setConfigValue({
			fields: [
				...(config?.fields || []),
				{
					id: `field_${crypto.randomUUID().replaceAll("-", "")}`,
					label: "Новое поле",
					type: "text",
					required: true,
				},
			],
		});

	const save = async () => {
		if (!form.name.trim()) {
			setError("Введите название услуги");
			setTab("main");
			return;
		}
		if (!queueOn && !bookingOn) {
			setError("Включите хотя бы один канал: «Очередь» или «Запись»");
			return;
		}
		setSaving(true);
		setError("");
		setNotice("");
		try {
			const body = {
				name: form.name.trim(),
				description: form.description,
				avg_duration_minutes: form.avg_duration_minutes,
				priority: form.priority,
				daily_limit: form.daily_limit ? parseInt(form.daily_limit, 10) : null,
				enabled: queueOn,
			};
			const res = isNew
				? await apiFetch("/api/services", {
						method: "POST",
						body: JSON.stringify(body),
					})
				: await apiFetch(`/api/services/${service.id}`, {
						method: "PUT",
						body: JSON.stringify(body),
					});
			if (!res) throw new Error("Сессия истекла, войдите заново");
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || "Не удалось сохранить услугу");
			}
			const saved = await res.json();
			if (!saved?.id) throw new Error("Не удалось сохранить услугу");
			setSavedId(saved.id);

			// Услуга по умолчанию — отдельный переключатель на сервере.
			if (Boolean(saved.is_default) !== Boolean(form.is_default)) {
				await apiFetch(`/api/services/${saved.id}/set-default`, {
					method: "PUT",
				});
			}

			// Канал «Запись» хранится в модуле записи. Расписание и постоянная
			// ссылка сохраняются при выключении и повторном включении.
			if (bookingEnabled && (bookingOn || config)) {
				const next = {
					...(config || defaultBookingConfig()),
					enabled: bookingOn,
				};
				const res2 = await apiFetch(
					`/api/booking/services/${saved.id}/config`,
					{ method: "PUT", body: JSON.stringify(next) },
				);
				if (!res2) throw new Error("Сессия истекла, войдите заново");
				if (!res2.ok) {
					const data = await res2.json().catch(() => ({}));
					throw new Error(
						data.error || "Не удалось сохранить настройки записи",
					);
				}
				const row = await res2.json();
				setConfig(row);
			}

			setNotice("Сохранено");
			onSaved?.();
		} catch (e) {
			setError(e.message || "Не удалось сохранить");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
			onClick={onClose}
			data-testid="service-editor"
		>
			<div
				className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={isNew ? "Новая услуга" : `Услуга: ${form.name}`}
			>
				{/* Шапка */}
				<div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
					<div className="min-w-0">
						<h2 className="truncate text-lg font-bold text-gray-900">
							{isNew ? "Новая услуга" : `Услуга: ${form.name}`}
						</h2>
						<p className="mt-0.5 text-xs text-gray-500">
							{isNew
								? "Заполните название и выберите, где будет работать услуга."
								: "Здесь настраиваются очередь и запись. Каналы работают независимо."}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Закрыть"
						className="rounded-lg p-1.5 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					>
						×
					</button>
				</div>

				{/* Содержимое */}
				<div className="flex-1 overflow-y-auto px-6 py-5">
					{/* Каналы */}
					<section className="mb-6">
						<SectionTitle
							title="Каналы услуги"
							hint="Клиент может записаться заранее, взять талон в очереди или пользоваться обоими способами."
						/>
						<div className="grid gap-3 sm:grid-cols-2">
							<ChannelCard
								checked={queueOn}
								onChange={setQueueOn}
								title="Очередь"
								description="Клиент берёт талон и ждёт вызова. Работает на постах оператора."
							/>
							{bookingEnabled && (
								<ChannelCard
									checked={bookingOn}
									onChange={setBookingOn}
									title="Запись"
									description="Клиент сам выбирает дату и время по расписанию, без талона."
								/>
							)}
						</div>
						{!queueOn && !bookingOn && (
							<p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
								Включите хотя бы один канал, иначе услуга не будет работать.
							</p>
						)}
					</section>

					{/* Вкладки */}
					<div className="mb-4 flex gap-1 border-b border-gray-100">
						{tabs.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => setTab(t.id)}
								className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
									tab === t.id
										? "border-blue-600 text-blue-600"
										: "border-transparent text-gray-500 hover:text-gray-700"
								}`}
							>
								{t.label}
							</button>
						))}
					</div>

					{/* Основное */}
					{tab === "main" && (
						<div className="space-y-4">
							<div>
								<label className="mb-1 block text-xs font-medium text-gray-500">
									Название услуги *
								</label>
								<input
									type="text"
									value={form.name}
									onChange={(e) =>
										setForm((f) => ({ ...f, name: e.target.value }))
									}
									placeholder="Например: Ремонт ГБО"
									className={input}
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-medium text-gray-500">
									Описание
								</label>
								<textarea
									value={form.description}
									onChange={(e) =>
										setForm((f) => ({
											...f,
											description: e.target.value,
										}))
									}
									rows={2}
									placeholder="Что делает эта услуга (необязательно)"
									className={input}
								/>
							</div>
							<label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
								<input
									type="checkbox"
									checked={form.is_default}
									onChange={(e) =>
										setForm((f) => ({
											...f,
											is_default: e.target.checked,
										}))
									}
									className="h-4 w-4 rounded border-gray-300"
								/>
								Сделать услугой по умолчанию
								<span className="text-xs text-gray-400">
									— её выводят первой при выборе услуги
								</span>
							</label>
						</div>
					)}

					{/* Очередь */}
					{tab === "queue" && (
						<div className="space-y-6">
							<div className="grid gap-3 sm:grid-cols-3">
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-500">
										Среднее время, мин
									</label>
									<input
										type="number"
										min={0}
										max={120}
										value={form.avg_duration_minutes}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												avg_duration_minutes: Math.max(
													0,
													parseInt(e.target.value, 10) || 0,
												),
											}))
										}
										className={input}
									/>
									<p className="mt-1 text-xs text-gray-400">
										0 — не показывать посетителю
									</p>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-500">
										Приоритет
									</label>
									<input
										type="number"
										min={0}
										max={100}
										value={form.priority}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												priority: parseInt(e.target.value, 10) || 0,
											}))
										}
										className={input}
									/>
									<p className="mt-1 text-xs text-gray-400">
										Порядок услуги в списке для посетителя: больше — выше. На
										порядок вызова в очереди не влияет
									</p>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-500">
										Лимит талонов в день
									</label>
									<input
										type="number"
										min={0}
										value={form.daily_limit}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												daily_limit: e.target.value,
											}))
										}
										placeholder="Без лимита"
										className={input}
									/>
									<p className="mt-1 text-xs text-gray-400">
										0 или пусто — без ограничения
									</p>
								</div>
							</div>

							<section>
								<SectionTitle
									title="Поля анкеты"
									hint="Клиент заполняет их при получении талона в очереди."
								/>
								{savedId ? (
									<QueueFieldsEditor serviceId={savedId} />
								) : (
									<p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
										Сохраните услугу — и здесь можно будет добавить поля анкеты.
									</p>
								)}
							</section>
						</div>
					)}

					{/* Запись */}
					{tab === "booking" && (
						<div className="space-y-6">
							{loadingConfig ? (
								<p className="text-sm text-gray-500">
									Загружаем настройки записи…
								</p>
							) : (
								<>
									<div className="grid gap-3 sm:grid-cols-3">
										<div>
											<label className="mb-1 block text-xs font-medium text-gray-500">
												Длительность приёма, мин
											</label>
											<input
												type="number"
												min={1}
												max={1440}
												value={config?.duration_minutes ?? 30}
												onChange={(e) =>
													setConfigValue({
														duration_minutes: Number(e.target.value),
													})
												}
												className={input}
											/>
										</div>
										<div>
											<label className="mb-1 block text-xs font-medium text-gray-500">
												Количество постов
											</label>
											<input
												type="number"
												min={1}
												max={100}
												value={config?.capacity ?? 1}
												onChange={(e) =>
													setConfigValue({
														capacity: Number(e.target.value),
													})
												}
												className={input}
											/>
											<p className="mt-1 text-xs text-gray-400">
												Сколько клиентов можно принять одновременно
											</p>
										</div>
										<div>
											<label className="mb-1 block text-xs font-medium text-gray-500">
												Часовой пояс
											</label>
											<input
												type="text"
												value={config?.timezone ?? "Europe/Moscow"}
												onChange={(e) =>
													setConfigValue({ timezone: e.target.value })
												}
												className={input}
											/>
											<p className="mt-1 text-xs text-gray-400">
												Europe/Moscow
											</p>
										</div>
									</div>

									<section>
										<SectionTitle
											title="Рабочие дни и время"
											hint="Отметьте дни, когда принимаете клиентов, и укажите часы работы."
										/>
										<div className="space-y-2">
											{WEEKDAYS.map(({ day, label }) => {
												const period = (config?.schedule || []).find(
													(p) => p.day === day,
												);
												return (
													<div
														key={day}
														className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${
															period
																? "border-blue-100 bg-blue-50/40"
																: "border-gray-100 bg-gray-50/60"
														}`}
													>
														<label className="flex w-44 cursor-pointer items-center gap-2 text-sm text-gray-700">
															<input
																type="checkbox"
																checked={!!period}
																onChange={(e) => setDay(day, e.target.checked)}
																className="h-4 w-4 rounded border-gray-300"
															/>
															{label}
														</label>
														{period && (
															<div className="flex items-center gap-2 text-sm text-gray-500">
																<input
																	type="time"
																	aria-label={`${label} начало`}
																	value={period.start}
																	onChange={(e) =>
																		setPeriod(day, "start", e.target.value)
																	}
																	className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
																/>
																<span>—</span>
																<input
																	type="time"
																	aria-label={`${label} конец`}
																	value={period.end}
																	onChange={(e) =>
																		setPeriod(day, "end", e.target.value)
																	}
																	className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
																/>
															</div>
														)}
													</div>
												);
											})}
										</div>
									</section>

									<section>
										<SectionTitle
											title="Нерабочие даты"
											hint="Например, праздники или дни ремонта. Даты через запятую, в формате 2026-01-01."
										/>
										<input
											type="text"
											value={(config?.exceptions || []).join(", ")}
											onChange={(e) =>
												setConfigValue({
													exceptions: e.target.value
														.split(",")
														.map((x) => x.trim())
														.filter(Boolean),
												})
											}
											placeholder="2026-01-01, 2026-05-09"
											className={input}
										/>
									</section>

									<section>
										<div className="mb-3 flex items-center justify-between">
											<SectionTitle
												title="Поля клиента"
												hint="Клиент заполняет их при записи на приём."
											/>
											<button
												type="button"
												onClick={addBookingField}
												className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
											>
												+ Добавить поле
											</button>
										</div>
										<div className="space-y-2">
											{(config?.fields || []).length === 0 && (
												<p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
													Полей нет — клиент укажет только телефон.
												</p>
											)}
											{(config?.fields || []).map((field, index) => (
												<div
													key={field.id}
													className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
												>
													<input
														type="text"
														aria-label="Название поля"
														value={field.label}
														onChange={(e) =>
															setConfigValue({
																fields: config.fields.map((f, i) =>
																	i === index
																		? { ...f, label: e.target.value }
																		: f,
																),
															})
														}
														className="min-w-[160px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
													/>
													<select
														aria-label="Тип поля"
														value={field.type}
														onChange={(e) =>
															setConfigValue({
																fields: config.fields.map((f, i) =>
																	i === index
																		? { ...f, type: e.target.value }
																		: f,
																),
															})
														}
														className="rounded-lg border border-gray-200 px-2.5 py-2 text-sm"
													>
														{BOOKING_FIELD_TYPES.map((t) => (
															<option key={t.value} value={t.value}>
																{t.label}
															</option>
														))}
													</select>
													<label className="flex items-center gap-1.5 text-sm text-gray-600">
														<input
															type="checkbox"
															checked={!!field.required}
															onChange={(e) =>
																setConfigValue({
																	fields: config.fields.map((f, i) =>
																		i === index
																			? { ...f, required: e.target.checked }
																			: f,
																	),
																})
															}
															className="h-4 w-4 rounded border-gray-300"
														/>
														обязательное
													</label>
													<button
														type="button"
														onClick={() =>
															setConfigValue({
																fields: config.fields.filter(
																	(_, i) => i !== index,
																),
															})
														}
														className="rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
													>
														Удалить
													</button>
												</div>
											))}
										</div>
									</section>

									<section className="space-y-2 rounded-xl bg-gray-50 p-4">
										<SectionTitle
											title="Постоянный виджет"
											hint="Ссылка не меняется при выключении и повторном включении записи."
										/>
										{widgetUrl ? (
											<>
												<div className="flex flex-wrap gap-2">
													<a
														href={widgetUrl}
														target="_blank"
														rel="noreferrer"
														className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
													>
														Открыть виджет
													</a>
													<button
														type="button"
														onClick={() => {
															navigator.clipboard?.writeText(widgetUrl);
															setNotice("Ссылка на виджет скопирована");
														}}
														className="rounded-lg bg-white px-4 py-2 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
													>
														Скопировать ссылку
													</button>
												</div>
												<input
													readOnly
													aria-label="Ссылка на виджет"
													className={`${input} bg-white`}
													value={widgetUrl}
												/>
												<p className="text-xs font-medium text-gray-500">
													Код для вставки на сайт:
												</p>
												<textarea
													readOnly
													aria-label="Код встраивания"
													rows={3}
													className={`${input} bg-white font-mono text-xs`}
													value={embedCode}
												/>
											</>
										) : (
											<p className="text-sm text-gray-500">
												Ссылка на виджет и код для сайта появятся после
												сохранения услуги.
											</p>
										)}
									</section>
								</>
							)}
						</div>
					)}
				</div>

				{/* Подвал */}
				<div className="border-t border-gray-100 px-6 py-4">
					{error && (
						<p
							role="alert"
							className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700"
						>
							{error}
						</p>
					)}
					{notice && (
						<p
							role="status"
							className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700"
						>
							{notice}
						</p>
					)}
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs text-gray-400">
							Изменения применятся сразу после сохранения.
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
							>
								Закрыть
							</button>
							<button
								type="button"
								onClick={save}
								disabled={saving}
								className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
							>
								<Icon d={P.check} cls="w-4 h-4" />
								{saving ? "Сохраняем…" : isNew ? "Создать услугу" : "Сохранить"}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({ checked, onChange, title, description }) {
	return (
		<label
			className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ${
				checked
					? "border-blue-500 bg-blue-50/60"
					: "border-gray-200 bg-white hover:border-gray-300"
			}`}
		>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600"
			/>
			<span>
				<span className="block text-sm font-bold text-gray-800">{title}</span>
				<span className="mt-0.5 block text-xs text-gray-500">
					{description}
				</span>
			</span>
		</label>
	);
}
