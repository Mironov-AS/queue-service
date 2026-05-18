import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../../api";
import { Icon, P } from "./shared";

export default function SettingsTab() {
	const [resetDone, setResetDone] = useState(false);
	const [autoReset, setAutoReset] = useState({ enabled: false, time: "00:00" });
	const [autoResetSaved, setAutoResetSaved] = useState(false);
	const [windowsCount, setWindowsCount] = useState(1);
	const [windowsSaved, setWindowsSaved] = useState(false);

	// Logo state
	const [logoUrl, setLogoUrl] = useState(null);
	const [logoKey, setLogoKey] = useState(null);
	const [logoUploading, setLogoUploading] = useState(false);
	const [logoError, setLogoError] = useState("");
	const [logoSuccess, setLogoSuccess] = useState("");
	const [dragOver, setDragOver] = useState(false);
	const fileRef = useRef(null);

	useEffect(() => {
		apiFetch("/api/settings/auto-reset")
			.then((r) => r?.json())
			.then((d) => {
				if (d) setAutoReset(d);
			});
		apiFetch("/api/settings/windows")
			.then((r) => r?.json())
			.then((d) => {
				if (d) setWindowsCount(d.windows_count);
			});
		apiFetch("/api/settings/logo")
			.then((r) => r?.json())
			.then((d) => {
				if (d) {
					setLogoKey(d.logo_key);
					// logo_url is /api/settings/logo/data when logo is set
					setLogoUrl(d.logo_url);
				}
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

	const resetQueue = async () => {
		if (!confirm("Сбросить всю очередь? Все ожидающие талоны будут отменены."))
			return;
		await apiFetch("/api/queue/reset", { method: "POST" });
		setResetDone(true);
		setTimeout(() => setResetDone(false), 3000);
	};

	const saveWindowsCount = async (val) => {
		const count = Math.max(1, Math.min(20, parseInt(val, 10) || 1));
		setWindowsCount(count);
		const r = await apiFetch("/api/settings/windows", {
			method: "PUT",
			body: JSON.stringify({ windows_count: count }),
		});
		if (r?.ok) {
			setWindowsSaved(true);
			setTimeout(() => setWindowsSaved(false), 2000);
		}
	};

	// Logo handlers
	const uploadLogo = async (file) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			setLogoError("Выберите изображение (JPEG, PNG, GIF, WebP, SVG)");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			setLogoError("Файл слишком большой. Максимум 5 МБ");
			return;
		}
		setLogoError("");
		setLogoUploading(true);
		try {
			const fd = new FormData();
			fd.append("file", file);
			const r = await fetch("/api/settings/logo", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
				},
				body: fd,
			});
			const d = await r.json();
			if (r.ok) {
				setLogoKey(d.logo_key);
				setLogoUrl(d.logo_url);
				setLogoSuccess("Логотип сохранён");
				setTimeout(() => setLogoSuccess(""), 3000);
			} else {
				setLogoError(d.error || "Ошибка загрузки");
			}
		} catch (e) {
			setLogoError("Ошибка сети");
		} finally {
			setLogoUploading(false);
		}
	};

	const deleteLogo = async () => {
		if (!logoKey) return;
		if (!confirm("Удалить логотип?")) return;
		const r = await apiFetch("/api/settings/logo", { method: "DELETE" });
		if (r?.ok) {
			setLogoKey(null);
			setLogoUrl(null);
			setLogoSuccess("Логотип удалён");
			setTimeout(() => setLogoSuccess(""), 3000);
		}
	};

	const handleFileChange = (e) => {
		const file = e.target.files?.[0];
		if (file) uploadLogo(file);
		e.target.value = "";
	};

	const handleDrop = (e) => {
		e.preventDefault();
		setDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file) uploadLogo(file);
	};

	return (
		<div className="space-y-6 max-w-md">
			{/* Logo upload */}
			<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
				<h3 className="font-semibold text-gray-800">Логотип на дашборде</h3>
				<p className="text-sm text-gray-500">
					Логотип отображается внизу по центру на экране ожидания. Максимальный
					размер — 5 МБ (JPEG, PNG, GIF, WebP, SVG).
				</p>

				{/* Current logo preview */}
				{logoUrl && (
					<div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
						<img
							src={logoUrl}
							alt="Текущий логотип"
							className="h-14 object-contain"
							onError={(e) => {
								e.target.style.display = "none";
							}}
						/>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium text-gray-700 truncate">
								Логотип загружен
							</p>
							<p className="text-xs text-gray-400 mt-0.5">
								Отображается внизу дашборда
							</p>
						</div>
					</div>
				)}

				{/* Drop zone / upload button */}
				<div
					onDragOver={(e) => {
						e.preventDefault();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={handleDrop}
					onClick={() => !logoUploading && fileRef.current?.click()}
					className={`relative flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none ${
						dragOver
							? "border-blue-400 bg-blue-50"
							: "border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"
					} ${logoUploading ? "opacity-60 cursor-wait" : ""}`}
				>
					{logoUploading ? (
						<>
							<svg
								className="w-8 h-8 text-blue-400 animate-spin"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								/>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
								/>
							</svg>
							<p className="text-sm text-gray-500">Загрузка…</p>
						</>
					) : (
						<>
							<svg
								className="w-8 h-8 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="1.5"
									d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2 1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							<p className="text-sm text-gray-600">
								{logoUrl
									? "Перетащите или нажмите для замены"
									: "Перетащите изображение или нажмите для выбора"}
							</p>
						</>
					)}
					<input
						ref={fileRef}
						type="file"
						accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
						className="hidden"
						onChange={handleFileChange}
					/>
				</div>

				{logoError && <p className="text-red-500 text-xs">{logoError}</p>}
				{logoSuccess && <p className="text-green-600 text-xs">{logoSuccess}</p>}

				{logoUrl && (
					<button
						onClick={deleteLogo}
						className="flex items-center gap-2 text-sm text-red-500 border border-red-200 hover:bg-red-50 font-medium px-4 py-2 rounded-xl transition"
					>
						<svg
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
						Удалить логотип
					</button>
				)}
			</div>

			{/* Windows count */}
			<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
				<h3 className="font-semibold text-gray-800">Окна обслуживания</h3>
				<p className="text-sm text-gray-500">
					Укажите количество окон обслуживания. При нескольких окнах оператор
					выбирает номер окна при вызове талона, а посетители видят номер окна
					на дашборде.
				</p>
				<div className="flex items-center gap-3">
					<label className="text-sm font-medium text-gray-700">
						Количество окон
					</label>
					<input
						type="number"
						min={1}
						max={20}
						value={windowsCount}
						onChange={(e) => saveWindowsCount(e.target.value)}
						className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-20 text-center"
					/>
					{windowsSaved && (
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
