import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../api";
import { Icon, P } from "./shared";

export default function SystemSettingsTab() {
	const [pwForm, setPwForm] = useState({
		currentPassword: "",
		newPassword: "",
		confirm: "",
	});
	const [pwError, setPwError] = useState("");
	const [pwOk, setPwOk] = useState(false);
	const [resetDone, setResetDone] = useState(false);
	const [autoReset, setAutoReset] = useState({ enabled: false, time: "00:00" });
	const [autoResetSaved, setAutoResetSaved] = useState(false);
	const [autoOpen, setAutoOpen] = useState({ enabled: false, time: "09:00" });
	const [autoOpenSaved, setAutoOpenSaved] = useState(false);
	const navigate = useNavigate();
	const user = (() => {
		try {
			return JSON.parse(localStorage.getItem("adminUser"));
		} catch {
			return null;
		}
	})();

	const logout = () => {
		localStorage.removeItem("adminToken");
		localStorage.removeItem("adminUser");
		navigate("/login", { replace: true });
	};

	useEffect(() => {
		apiFetch("/api/settings/auto-reset")
			.then((r) => r?.json())
			.then((d) => {
				if (d) setAutoReset(d);
			});
		apiFetch("/api/settings/auto-open")
			.then((r) => r?.json())
			.then((d) => {
				if (d) setAutoOpen(d);
			});
	}, []);

	const saveAutoReset = async (patch) => {
		const next = { ...autoReset, ...patch };
		setAutoReset(next);
		const r = await apiFetch("/api/settings/auto-reset", {
			method: "PUT",
			body: JSON.stringify(next),
		});
		if (r?.ok) {
			setAutoResetSaved(true);
			setTimeout(() => setAutoResetSaved(false), 2000);
		}
	};

	const saveAutoOpen = async (patch) => {
		const next = { ...autoOpen, ...patch };
		setAutoOpen(next);
		const r = await apiFetch("/api/settings/auto-open", {
			method: "PUT",
			body: JSON.stringify(next),
		});
		if (r?.ok) {
			setAutoOpenSaved(true);
			setTimeout(() => setAutoOpenSaved(false), 2000);
		}
	};

	const resetQueue = async () => {
		if (!confirm("Сбросить всю очередь? Все ожидающие талоны будут отменены."))
			return;
		await apiFetch("/api/queue/reset", { method: "POST" });
		setResetDone(true);
		setTimeout(() => setResetDone(false), 3000);
	};

	const changePassword = async () => {
		setPwError("");
		setPwOk(false);
		if (pwForm.newPassword !== pwForm.confirm) {
			setPwError("Пароли не совпадают");
			return;
		}
		if (pwForm.newPassword.length < 8) {
			setPwError("Пароль должен быть не менее 8 символов");
			return;
		}
		const r = await apiFetch("/api/settings/password", {
			method: "PUT",
			body: JSON.stringify(pwForm),
		});
		if (!r) return;
		const data = await r.json();
		if (!r.ok) {
			setPwError(data.error || "Ошибка");
			return;
		}
		setPwOk(true);
		setPwForm({ currentPassword: "", newPassword: "", confirm: "" });
		if (data.token) localStorage.setItem("adminToken", data.token);
		const mustChange = localStorage.getItem("mustChangePassword");
		if (mustChange) {
			localStorage.removeItem("mustChangePassword");
			navigate("/admin", { replace: true });
		}
	};

	return (
		<div className="space-y-6 max-w-md">
			{/* User info */}
			<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
				<div className="flex items-center gap-4">
					<div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
						<Icon d={P.person} cls="w-6 h-6 text-blue-600" />
					</div>
					<div>
						<div className="font-bold text-gray-900">
							{user?.username || "admin"}
						</div>
						<div className="text-sm text-gray-400 capitalize">
							{user?.role || "admin"}
						</div>
					</div>
					<button
						onClick={logout}
						className="ml-auto flex items-center gap-2 text-sm text-red-500 hover:text-red-700 px-3 py-2 rounded-xl hover:bg-red-50"
					>
						<Icon d={P.logout} cls="w-4 h-4" /> Выйти
					</button>
				</div>
			</div>

			{/* Change password */}
			<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
				<h3 className="font-semibold text-gray-800">Управление паролем</h3>
				<p className="text-sm text-gray-500">
					Измените пароль учётной записи администратора.
				</p>
				{[
					{ key: "currentPassword", label: "Текущий пароль" },
					{ key: "newPassword", label: "Новый пароль" },
					{ key: "confirm", label: "Повторите пароль" },
				].map((f) => (
					<div key={f.key}>
						<label className="text-xs text-gray-500 font-medium mb-1 block">
							{f.label}
						</label>
						<input
							type="password"
							value={pwForm[f.key]}
							onChange={(e) =>
								setPwForm((p) => ({ ...p, [f.key]: e.target.value }))
							}
							className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>
				))}
				{pwError && <p className="text-red-500 text-sm">{pwError}</p>}
				{pwOk && (
					<p className="text-green-600 text-sm">Пароль успешно изменён</p>
				)}
				<button
					onClick={changePassword}
					className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl"
				>
					Сохранить пароль
				</button>
			</div>

			{/* Auto-open registration */}
			<div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6 space-y-4">
				<h3 className="font-semibold text-gray-800">Автооткрытие записи</h3>
				<p className="text-sm text-gray-500">
					Если в указанное время запись была закрыта — она автоматически
					откроется.
				</p>

				<div className="flex items-center gap-3">
					<label className="flex items-center gap-2 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={autoOpen.enabled}
							onChange={(e) => saveAutoOpen({ enabled: e.target.checked })}
							className="w-4 h-4 accent-green-500 cursor-pointer"
						/>
						<span className="text-sm font-medium text-gray-700">
							Автооткрытие
						</span>
					</label>
					<input
						type="time"
						value={autoOpen.time}
						onChange={(e) => saveAutoOpen({ time: e.target.value })}
						className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 w-32"
					/>
					{autoOpenSaved && (
						<span className="text-green-600 text-xs">Сохранено</span>
					)}
				</div>
			</div>

			{/* Reset queue */}
			<div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 space-y-4">
				<h3 className="font-semibold text-gray-800">Сброс очереди</h3>
				<p className="text-sm text-gray-500">
					Все ожидающие талоны сегодняшнего дня будут отменены. Действие
					необратимо.
				</p>

				<div className="flex items-center gap-3">
					{resetDone && (
						<p className="text-green-600 text-sm">Очередь сброшена</p>
					)}
					<button
						onClick={resetQueue}
						className="flex items-center gap-2 text-sm text-red-600 border border-red-200 hover:bg-red-50 font-medium px-4 py-2.5 rounded-xl transition"
					>
						<Icon d={P.repeat} cls="w-4 h-4" /> Сбросить сейчас
					</button>
				</div>

				<div className="border-t border-gray-100 pt-4 space-y-3">
					<div className="flex items-center gap-3">
						<label className="flex items-center gap-2 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={autoReset.enabled}
								onChange={(e) => saveAutoReset({ enabled: e.target.checked })}
								className="w-4 h-4 accent-red-500 cursor-pointer"
							/>
							<span className="text-sm font-medium text-gray-700">
								Автосброс
							</span>
						</label>
						<input
							type="time"
							value={autoReset.time}
							onChange={(e) => saveAutoReset({ time: e.target.value })}
							className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 w-32"
						/>
						{autoResetSaved && (
							<span className="text-green-600 text-xs">Сохранено</span>
						)}
					</div>
					<p className="text-xs text-gray-400">
						Очередь будет автоматически сброшена каждый день в указанное время.
					</p>
				</div>
			</div>
		</div>
	);
}
