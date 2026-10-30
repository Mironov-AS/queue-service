import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { Icon, P, FIELD_TYPES } from "./shared";

// Поля анкеты очереди: клиент заполняет их при получении талона.
// Это отдельный список от полей формы записи. Редактор используется внутри
// модального окна редактирования услуги.
export default function QueueFieldsEditor({ serviceId, onChanged }) {
	const [fields, setFields] = useState([]);
	const [form, setForm] = useState({
		label: "",
		field_type: "text",
		required: false,
		require_check: false,
	});
	const [editingId, setEditingId] = useState(null);
	const [error, setError] = useState("");

	const load = async () => {
		if (!serviceId) return;
		const res = await apiFetch(`/api/services/${serviceId}/fields`);
		if (!res || !res.ok) return;
		setFields(await res.json());
	};

	useEffect(() => {
		load();
	}, [serviceId]);

	const save = async () => {
		if (!form.label.trim()) {
			setError("Введите название поля");
			return;
		}
		setError("");
		if (editingId) {
			await apiFetch(`/api/service-fields/${editingId}`, {
				method: "PUT",
				body: JSON.stringify(form),
			});
			setEditingId(null);
		} else {
			await apiFetch(`/api/services/${serviceId}/fields`, {
				method: "POST",
				body: JSON.stringify(form),
			});
		}
		setForm({
			label: "",
			field_type: "text",
			required: false,
			require_check: false,
		});
		await load();
		onChanged?.();
	};

	const startEdit = (f) => {
		setEditingId(f.id);
		setForm({
			label: f.label,
			field_type: f.field_type,
			required: !!f.required,
			require_check: !!f.require_check,
		});
		setError("");
	};

	const remove = async (id) => {
		await apiFetch(`/api/service-fields/${id}`, { method: "DELETE" });
		await load();
		onChanged?.();
	};

	const move = async (field, dir) => {
		const idx = fields.findIndex((f) => f.id === field.id);
		const swapIdx = idx + dir;
		if (swapIdx < 0 || swapIdx >= fields.length) return;
		const swap = fields[swapIdx];
		await Promise.all([
			apiFetch(`/api/service-fields/${field.id}`, {
				method: "PUT",
				body: JSON.stringify({ order_index: swap.order_index }),
			}),
			apiFetch(`/api/service-fields/${swap.id}`, {
				method: "PUT",
				body: JSON.stringify({ order_index: field.order_index }),
			}),
		]);
		await load();
		onChanged?.();
	};

	return (
		<div className="space-y-3">
			{fields.length === 0 ? (
				<p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-500">
					Дополнительных полей нет. Клиент увидит только номер телефона.
				</p>
			) : (
				<div className="space-y-2">
					{fields.map((f, i) => (
						<div
							key={f.id}
							className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
								editingId === f.id
									? "border-blue-300 bg-blue-50"
									: "border-gray-100 bg-gray-50"
							}`}
						>
							<div className="flex flex-col gap-0.5">
								<button
									type="button"
									onClick={() => move(f, -1)}
									disabled={i === 0}
									title="Выше"
									className="text-gray-300 hover:text-gray-500 disabled:opacity-20"
								>
									<Icon d={P.up} cls="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => move(f, 1)}
									disabled={i === fields.length - 1}
									title="Ниже"
									className="text-gray-300 hover:text-gray-500 disabled:opacity-20"
								>
									<Icon d={P.down} cls="w-3.5 h-3.5" />
								</button>
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-medium text-sm text-gray-800 truncate">
									{f.label}
								</div>
								<div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5 flex-wrap">
									<span>
										{FIELD_TYPES.find((t) => t.value === f.field_type)?.label ||
											f.field_type}
									</span>
									{f.required ? (
										<span className="text-red-500 font-semibold">
											• обязательное
										</span>
									) : (
										<span>• необязательное</span>
									)}
									{f.require_check ? (
										<span className="text-orange-600 font-semibold">
											• проверка дублей
										</span>
									) : null}
								</div>
							</div>
							<div className="flex gap-1 shrink-0">
								<button
									type="button"
									onClick={() => startEdit(f)}
									title="Изменить поле"
									className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg"
								>
									<Icon d={P.edit} cls="w-4 h-4" />
								</button>
								<button
									type="button"
									onClick={() => remove(f.id)}
									title="Удалить поле"
									className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded-lg"
								>
									<Icon d={P.trash} cls="w-4 h-4" />
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			<div className="rounded-xl border border-dashed border-gray-200 p-3 space-y-3">
				<p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
					{editingId ? "Изменить поле" : "Добавить поле"}
				</p>
				<input
					type="text"
					value={form.label}
					onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
					placeholder="Название поля (например: ФИО, Номер документа)"
					className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					onKeyDown={(e) => e.key === "Enter" && save()}
				/>
				<div className="flex gap-2 flex-wrap">
					<select
						value={form.field_type}
						onChange={(e) =>
							setForm((f) => ({ ...f, field_type: e.target.value }))
						}
						className="flex-1 min-w-[140px] rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					>
						{FIELD_TYPES.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
					<label className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
						<input
							type="checkbox"
							checked={form.required}
							onChange={(e) =>
								setForm((f) => ({ ...f, required: e.target.checked }))
							}
							className="rounded"
						/>
						Обязательное
					</label>
					<label className="flex items-center gap-2 px-3 py-2.5 border border-orange-200 bg-orange-50 rounded-xl cursor-pointer hover:bg-orange-100 text-sm whitespace-nowrap">
						<input
							type="checkbox"
							checked={form.require_check}
							onChange={(e) =>
								setForm((f) => ({ ...f, require_check: e.target.checked }))
							}
							className="rounded"
						/>
						<span className="text-orange-700">Проверять дубли</span>
					</label>
				</div>
				{form.require_check && (
					<p className="text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
						При регистрации будет проверено, есть ли активный талон с таким же
						значением этого поля
					</p>
				)}
				{error && <p className="text-red-500 text-sm">{error}</p>}
				<div className="flex gap-2">
					<button
						type="button"
						onClick={save}
						className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm"
					>
						<Icon d={editingId ? P.check : P.plus} cls="w-4 h-4" />
						{editingId ? "Сохранить поле" : "Добавить поле"}
					</button>
					{editingId && (
						<button
							type="button"
							onClick={() => {
								setEditingId(null);
								setForm({
									label: "",
									field_type: "text",
									required: false,
									require_check: false,
								});
							}}
							className="px-4 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 text-sm"
						>
							Отмена
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
