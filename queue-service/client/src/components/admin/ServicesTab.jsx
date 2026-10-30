import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import ServiceEditorModal from "./ServiceEditorModal";
import { Icon, P } from "./shared";

// UI only. Server must independently keep booking API disabled until release.
const bookingEnabled = import.meta.env.VITE_BOOKING_ENABLED === "true";

// ─── Services Tab ─────────────────────────────────────────────────────────────

export default function ServicesTab() {
	const [services, setServices] = useState([]);
	const [channels, setChannels] = useState({});
	const [editing, setEditing] = useState(null); // service object | "new"
	const [error, setError] = useState("");

	// Booking channel state is stored in the booking module, the queue channel
	// in the queue directory, so both are merged here by service id.
	const bookingRequest = async (url, options) => {
		const res = await apiFetch(url, options);
		if (!res) throw new Error("Необходима авторизация");
		const content = res.headers.get("content-type") || "";
		if (!content.includes("application/json"))
			throw new Error("Модуль записи пока не подключён");
		const result = await res.json();
		if (!res.ok) throw new Error(result.error || "Не удалось выполнить запрос");
		return result;
	};

	const loadChannels = async () => {
		if (!bookingEnabled) return {};
		const result = await bookingRequest("/api/booking/services");
		const map = {};
		for (const item of result.services || []) map[item.id] = item;
		return map;
	};

	const load = async () => {
		const list = await apiFetch("/api/services?all=1").then((r) => r?.json());
		if (list) setServices(list);
		if (!bookingEnabled) return;
		try {
			setChannels(await loadChannels());
			setError("");
		} catch (e) {
			setError(e.message);
		}
	};
	useEffect(() => {
		load();
	}, []);

	// Switching the booking channel keeps the schedule and the permanent
	// widget link of the service.
	const setBookingChannel = async (serviceId, enabled) => {
		const base = `/api/booking/services/${serviceId}`;
		const current = await bookingRequest(`${base}/config`);
		const config = current || {
			enabled,
			duration_minutes: 30,
			capacity: 1,
			timezone: "Europe/Moscow",
			schedule: [1, 2, 3, 4, 5].map((day) => ({
				day,
				start: "09:00",
				end: "18:00",
			})),
			exceptions: [],
			fields: [],
		};
		return bookingRequest(`${base}/config`, {
			method: "PUT",
			body: JSON.stringify({ ...config, enabled }),
		});
	};

	const toggleBookingChannel = async (s) => {
		setError("");
		const current = channels[s.id]?.booking_enabled === true;
		if (
			!current &&
			!window.confirm(
				`Включить запись для услуги «${s.name}»? Расписание и ссылку на виджет можно будет настроить в карточке услуги.`,
			)
		)
			return;
		if (
			current &&
			!window.confirm(
				`Отключить запись для услуги «${s.name}»? Ссылка на виджет сохранится, новые записи приниматься не будут.`,
			)
		)
			return;
		try {
			await setBookingChannel(s.id, !current);
			await load();
		} catch (e) {
			setError(e.message);
		}
	};

	const toggle = async (s) => {
		await apiFetch(`/api/services/${s.id}/toggle`, { method: "PUT" });
		load();
	};

	const remove = async (id) => {
		if (!confirm("Удалить услугу? Активные талоны останутся без услуги."))
			return;
		await apiFetch(`/api/services/${id}`, { method: "DELETE" });
		load();
	};

	const setDefault = async (s) => {
		await apiFetch(`/api/services/${s.id}/set-default`, { method: "PUT" });
		load();
	};

	return (
		<div className="space-y-6">
			{/* Заголовок и кнопка добавления */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-bold text-gray-900">Услуги</h2>
					<p className="mt-0.5 text-sm text-gray-500">
						Очередь и запись — независимые каналы. Настройте любой из них
						или оба сразу.
					</p>
				</div>
				<button
					type="button"
					onClick={() => setEditing("new")}
					className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
				>
					<Icon d={P.plus} cls="w-4 h-4" />
					Добавить услугу
				</button>
			</div>

			{error && (
				<p
					role="alert"
					className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700"
				>
					{error}
				</p>
			)}

			{/* Список услуг */}
			<div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
				{services.length === 0 ? (
					<div className="px-6 py-14 text-center">
						<p className="text-sm font-medium text-gray-600">
							Услуг пока нет
						</p>
						<p className="mt-1 text-xs text-gray-400">
							Добавьте первую услугу — можно сразу для очереди, для записи
							или для обоих каналов.
						</p>
						<button
							type="button"
							onClick={() => setEditing("new")}
							className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
						>
							<Icon d={P.plus} cls="w-4 h-4" />
							Добавить услугу
						</button>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] text-sm">
							<thead>
								<tr className="border-b border-gray-100 bg-gray-50">
									<th className="px-5 py-3 text-left font-semibold text-gray-500">
										Услуга
									</th>
									<th className="px-4 py-3 text-left font-semibold text-gray-500">
										Каналы
									</th>
									<th className="px-4 py-3 text-center font-semibold text-gray-500">
										Время
									</th>
									<th className="px-4 py-3 text-center font-semibold text-gray-500">
										Приоритет
									</th>
									<th className="px-4 py-3 text-center font-semibold text-gray-500">
										Лимит/день
									</th>
									<th className="px-4 py-3 text-center font-semibold text-gray-500">
										По умолчанию
									</th>
									<th className="px-5 py-3 text-right font-semibold text-gray-500">
										Действия
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-50">
								{services.map((s) => (
									<tr
										key={s.id}
										className={`transition hover:bg-gray-50 ${!s.enabled ? "opacity-60" : ""}`}
									>
										<td className="px-5 py-4">
											<div className="font-medium text-gray-800">
												{s.name}
											</div>
											{s.description && (
												<div className="mt-0.5 text-xs text-gray-400">
													{s.description}
												</div>
											)}
										</td>
										<td className="px-4 py-4">
											<div className="flex flex-wrap gap-1.5">
												<button
													type="button"
													onClick={() => toggle(s)}
													title={
														s.enabled
															? "Отключить услугу в очереди"
															: "Включить услугу в очереди"
													}
													className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
														s.enabled
															? "bg-green-100 text-green-700 hover:bg-green-200"
															: "bg-gray-100 text-gray-500 hover:bg-gray-200"
													}`}
												>
													Очередь: {s.enabled ? "вкл" : "выкл"}
												</button>
												{bookingEnabled ? (
													<button
														type="button"
														onClick={() => toggleBookingChannel(s)}
														title={
															channels[s.id]?.booking_enabled
																? "Отключить канал записи"
																: "Включить канал записи"
														}
														className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
															channels[s.id]?.booking_enabled
																? "bg-green-100 text-green-700 hover:bg-green-200"
																: "bg-gray-100 text-gray-500 hover:bg-gray-200"
														}`}
													>
														Запись:{" "}
														{channels[s.id]?.booking_enabled
															? "вкл"
															: "выкл"}
													</button>
												) : (
													<span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-400">
														Запись: выкл
													</span>
												)}
											</div>
										</td>
										<td className="px-4 py-4 text-center text-gray-600">
											{s.avg_duration_minutes > 0 ? (
												<span className="flex items-center justify-center gap-1">
													<Icon d={P.clock} cls="w-4 h-4 text-gray-400" />
													{s.avg_duration_minutes} мин
												</span>
											) : (
												<span className="text-gray-400">—</span>
											)}
										</td>
										<td className="px-4 py-4 text-center text-gray-600">
											{s.priority || 0}
										</td>
										<td className="px-4 py-4 text-center text-gray-500">
											{s.daily_limit || "∞"}
										</td>
										<td className="px-4 py-4 text-center">
											<button
												type="button"
												onClick={() => setDefault(s)}
												title={
													s.is_default
														? "Снять метку"
														: "Сделать по умолчанию"
												}
												className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
													s.is_default
														? "bg-amber-50 text-amber-500 hover:bg-amber-100"
														: "text-gray-300 hover:bg-amber-50 hover:text-amber-400"
												}`}
											>
												<Icon d={P.star} cls="w-4 h-4" />
											</button>
										</td>
										<td className="px-5 py-4">
											<div className="flex items-center justify-end gap-2">
												<button
													type="button"
													onClick={() => setEditing(s)}
													className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
												>
													<Icon d={P.edit} cls="w-3.5 h-3.5" />
													Редактировать
												</button>
												<button
													type="button"
													onClick={() => remove(s.id)}
													title="Удалить услугу"
													className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
												>
													<Icon d={P.trash} cls="w-4 h-4" />
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{editing && (
				<ServiceEditorModal
					service={editing === "new" ? null : editing}
					channels={channels}
					onClose={() => setEditing(null)}
					onSaved={load}
				/>
			)}
		</div>
	);
}
