import { useState, useEffect, useRef } from "react";
import socket from "../socket";
import TouchKeyboard from "../components/TouchKeyboard";

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ cls = "h-16" }) {
	return (
		<img
			src="/logo.png"
			alt="Максима"
			className={`object-contain pointer-events-none ${cls}`}
		/>
	);
}

// ─── Terminal Page ─────────────────────────────────────────────────────────────

export default function TerminalPage() {
	const [step, setStep] = useState("services"); // 'services' | 'form' | 'ticket' | 'countdown'
	const [ticket, setTicket] = useState(null);
	const [selectedService, setSelectedService] = useState(null);

	// Ticket obtained → go to countdown
	const onTicketObtained = (ticketData) => {
		setTicket(ticketData);
		setStep("countdown");
	};

	// Back to services
	const reset = () => {
		setStep("services");
		setTicket(null);
		setSelectedService(null);
	};

	if (step === "services") {
		return (
			<ServiceSelection
				onSelect={(svc) => {
					setSelectedService(svc);
					setStep("form");
				}}
			/>
		);
	}

	if (step === "form") {
		return (
			<ServiceForm
				service={selectedService}
				onBack={() => setStep("services")}
				onTicket={onTicketObtained}
			/>
		);
	}

	if (step === "countdown" && ticket) {
		return <TicketCountdown ticket={ticket} onNewTicket={reset} />;
	}

	return null;
}

// ─── Service Selection ──────────────────────────────────────────────────────────

const FIELD_INPUT_TYPES = {
	text: "text",
	phone: "tel",
	number: "number",
	date: "date",
	email: "email",
};

function ServiceSelection({ onSelect }) {
	const [services, setServices] = useState([]);
	const [regOpen, setRegOpen] = useState(true);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch("/api/settings/registration")
			.then((r) => r.json())
			.then((d) => setRegOpen(d.open))
			.catch(() => setRegOpen(true));

		fetch("/api/services")
			.then((r) => r.json())
			.then((data) => {
				setServices(data);
				setLoading(false);
			})
			.catch(() => setLoading(false));

		const handler = (d) => setRegOpen(d.open);
		socket.on("registration:changed", handler);
		return () => socket.off("registration:changed", handler);
	}, []);

	if (!regOpen) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-gray-700 to-gray-900 flex flex-col items-center justify-center p-6">
				<div className="w-full max-w-lg text-center space-y-6">
					<div className="text-8xl mb-4">🔒</div>
					<h1 className="text-4xl font-black text-white">Запись закрыта</h1>
					<p className="text-gray-300 text-xl">Обратитесь к сотруднику</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-blue-700 to-blue-900 flex items-center justify-center">
				<div className="text-white text-2xl font-bold animate-pulse">
					Загрузка...
				</div>
			</div>
		);
	}

	if (services.length === 0) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-gray-700 to-gray-900 flex flex-col items-center justify-center p-6">
				<div className="w-full max-w-lg text-center space-y-6">
					<div className="text-7xl mb-4">🔧</div>
					<h1 className="text-3xl font-black text-white">Услуги недоступны</h1>
					<p className="text-gray-300 text-lg">Обратитесь к сотруднику</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-700 to-blue-900 flex flex-col items-center justify-center p-6">
			<div className="w-full max-w-2xl">
				{/* Header */}
				<div className="text-center mb-8">
					<div className="text-5xl mb-3">🎫</div>
					<h1 className="text-3xl font-black text-white">Получить талон</h1>
					{services.length > 1 && (
						<p className="text-blue-200 mt-1 text-base">Выберите услугу</p>
					)}
				</div>

				{/* Services grid - large touch-friendly buttons */}
				<div className="space-y-4">
					{services.map((svc) => (
						<button
							key={svc.id}
							onClick={() => onSelect(svc)}
							className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:from-green-700 active:to-emerald-800 rounded-3xl p-6 shadow-xl hover:shadow-2xl transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-150"
						>
							<div className="flex items-center justify-between">
								<div className="flex-1 text-left">
									<h2 className="text-3xl font-black text-white leading-tight">
										{svc.name}
									</h2>
									{svc.description && (
										<p className="text-green-100 mt-1 text-base">
											{svc.description}
										</p>
									)}
								</div>
								{svc.avg_duration_minutes > 0 && (
									<span className="text-white/80 text-sm bg-white/20 px-3 py-1 rounded-full shrink-0">
										~{svc.avg_duration_minutes} мин
									</span>
								)}
							</div>
						</button>
					))}
				</div>
			</div>

			{/* Logo */}
			<div className="mt-10 flex justify-center">
				<Logo />
			</div>
		</div>
	);
}

// ─── Service Form ──────────────────────────────────────────────────────────────

function ServiceForm({ service, onBack, onTicket }) {
	const [fields, setFields] = useState([]);
	const [fieldValues, setFieldValues] = useState({});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [activeFieldId, setActiveFieldId] = useState(null);

	useEffect(() => {
		fetch(`/api/services/${service.id}/fields`)
			.then((r) => r.json())
			.then((data) => {
				setFields(data);
				const init = {};
				data.forEach((f) => {
					init[f.id] = "";
				});
				setFieldValues(init);
				// Автофокус на первое поле сразу при загрузке
				if (data.length > 0) {
					setActiveFieldId(data[0].id);
				}
			});
	}, [service]);

	const getTicket = async () => {
		for (const f of fields) {
			if (f.required && !fieldValues[f.id]?.trim()) {
				setError(`«${f.label}» обязательно`);
				return;
			}
		}
		setError("");
		setLoading(true);
		try {
			const fvArray = fields
				.map((f) => ({
					field_id: f.id,
					label: f.label,
					value: fieldValues[f.id] || "",
				}))
				.filter(
					(fv) =>
						fv.value.trim() !== "" ||
						fields.find((f) => f.id === fv.field_id)?.required,
				);

			const res = await fetch("/api/tickets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					service_id: service.id,
					field_values: fvArray.length ? fvArray : undefined,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setError(data.error || "Ошибка");
				return;
			}
			onTicket(data);
		} catch {
			setError("Ошибка соединения");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-700 to-blue-900 flex flex-col items-center p-4 pt-6">
			<div className="w-full max-w-lg">
				{/* Header - compact when keyboard is visible */}
				<div className="text-center mb-4">
					<h1 className="text-2xl font-black text-white">{service.name}</h1>
					{service.description && (
						<p className="text-blue-200 mt-1 text-base">
							{service.description}
						</p>
					)}
				</div>

				{/* Form card */}
				<div className="bg-white/10 backdrop-blur rounded-3xl shadow-2xl p-5 space-y-3">
					{fields.length > 0 ? (
						<div className="space-y-3">
							{fields.map((f) => (
								<div
									key={f.id}
									className={`rounded-xl p-0.5 transition-all ${
										activeFieldId === f.id
											? "bg-green-500/50 ring-2 ring-green-400"
											: "bg-transparent"
									}`}
								>
									<label className="block text-base font-semibold text-white mb-1 px-2">
										{f.label}
										{f.required && (
											<span className="text-yellow-300 ml-1">*</span>
										)}
									</label>
									<input
										type={FIELD_INPUT_TYPES[f.field_type] || "text"}
										value={fieldValues[f.id] || ""}
										onChange={(e) =>
											setFieldValues((v) => ({ ...v, [f.id]: e.target.value }))
										}
										onClick={() => setActiveFieldId(f.id)}
										className="w-full border-2 border-white/30 bg-white/90 rounded-xl px-4 py-3 text-xl focus:outline-none focus:border-yellow-400 focus:bg-white transition cursor-pointer"
										placeholder={`Введите ${f.label.toLowerCase()}`}
										autoComplete="off"
									/>
								</div>
							))}
						</div>
					) : (
						<div className="text-center text-white/70 text-xl py-8">
							Нажмите кнопку ниже для получения талона
						</div>
					)}

					{error && (
						<div className="bg-red-100 border-2 border-red-400 rounded-2xl p-4">
							<p className="text-red-700 text-xl text-center font-bold">
								{error}
							</p>
						</div>
					)}

					{/* Large touch-friendly get ticket button */}
					<button
						onClick={getTicket}
						disabled={loading}
						className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:from-green-700 active:to-emerald-800 disabled:opacity-50 text-white font-black py-5 rounded-2xl text-xl transition shadow-xl mt-3"
					>
						{loading ? "Оформляем..." : "ПОЛУЧИТЬ ТАЛОН"}
					</button>

					{/* Back button */}
					<button
						onClick={onBack}
						className="w-full text-white/70 hover:text-white py-3 text-center text-base transition"
					>
						← Назад
					</button>
				</div>

				{/* Logo - скрываем когда клавиатура видна */}
				{fields.length === 0 && (
					<div className="mt-6 flex justify-center">
						<Logo />
					</div>
				)}
			</div>

			{/* Touch Keyboard - always visible when there are fields */}
			{fields.length > 0 && (
				<TouchKeyboard
					fieldValues={fieldValues}
					onFieldChange={(fieldId, val) =>
						setFieldValues((v) => ({ ...v, [fieldId]: val }))
					}
					activeFieldId={activeFieldId}
					onFieldFocus={setActiveFieldId}
					onSubmit={getTicket}
					hasFields={fields.length > 0}
				/>
			)}
		</div>
	);
}

// ─── Ticket Countdown ───────────────────────────────────────────────────────────

function TicketCountdown({ ticket, onNewTicket }) {
	const [intervalSec, setIntervalSec] = useState(30); // seconds
	const [timeLeft, setTimeLeft] = useState(null);
	const [showThankYou, setShowThankYou] = useState(false);
	const timerRef = useRef(null);

	// Load interval from settings
	useEffect(() => {
		fetch("/api/settings/terminal-countdown")
			.then((r) => r.json())
			.then((d) => {
				const sec = d.seconds || 30;
				setIntervalSec(sec);
				setTimeLeft(sec);
			})
			.catch(() => {
				setIntervalSec(30);
				setTimeLeft(30);
			});
	}, []);

	// Countdown
	useEffect(() => {
		if (timeLeft === null) return;
		if (timeLeft <= 0) {
			setShowThankYou(true);
			return;
		}
		timerRef.current = setInterval(() => {
			setTimeLeft((prev) => {
				if (prev <= 1) {
					clearInterval(timerRef.current);
					setTimeout(() => setShowThankYou(true), 500);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => clearInterval(timerRef.current);
	}, [timeLeft]);

	// Auto-reset to services after 5 seconds on thank you screen
	useEffect(() => {
		if (!showThankYou) return;
		const autoResetTimer = setTimeout(() => {
			resetToServices();
		}, 5000);
		return () => clearTimeout(autoResetTimer);
	}, [showThankYou]);

	const resetToServices = () => {
		clearInterval(timerRef.current);
		onNewTicket();
	};

	const formatTime = (sec) => {
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s} сек`;
	};

	const progressPct = timeLeft !== null ? (timeLeft / intervalSec) * 100 : 100;

	// Thank you screen after countdown
	if (showThankYou) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex flex-col items-center justify-center p-6">
				<div className="w-full max-w-lg text-center space-y-8">
					<div className="text-8xl animate-bounce">🙏</div>
					<h1 className="text-5xl font-black text-white">Спасибо!</h1>
					<p className="text-green-100 text-2xl">Хорошего дня!</p>

					<button
						onClick={resetToServices}
						className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:from-green-700 active:to-emerald-800 text-white font-black py-8 rounded-3xl text-2xl shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
					>
						🎫 ПОЛУЧИТЬ НОВЫЙ ТАЛОН
					</button>
				</div>

				{/* Logo */}
				<div className="mt-6 flex justify-center">
					<Logo />
				</div>
			</div>
		);
	}

	// Countdown screen
	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-700 to-blue-900 flex flex-col items-center justify-center p-6">
			<div className="w-full max-w-lg space-y-8">
				{/* Ticket */}
				<div className="bg-white rounded-3xl p-10 shadow-2xl text-center">
					<p className="text-gray-400 text-sm uppercase tracking-wider mb-2">
						Ваш талон
					</p>
					<div className="text-8xl font-black text-blue-600 leading-none">
						№{ticket.number}
					</div>
					<p className="mt-4 text-gray-600 text-xl font-medium">
						{ticket.service_name || "Общая очередь"}
					</p>
				</div>

				{/* Countdown */}
				<div className="bg-white/20 backdrop-blur rounded-3xl p-8 space-y-6">
					<div className="text-center">
						<p className="text-blue-200 text-lg mb-2">Следующий клиент через</p>
						<div className="text-7xl font-black text-white">
							{formatTime(timeLeft ?? intervalSec)}
						</div>
					</div>

					{/* Progress bar */}
					<div className="h-4 bg-white/20 rounded-full overflow-hidden">
						<div
							className="h-full bg-white rounded-full transition-all duration-1000 ease-linear"
							style={{ width: `${progressPct}%` }}
						/>
					</div>
				</div>

				{/* New ticket button - large touch-friendly */}
				<button
					onClick={resetToServices}
					className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:from-green-700 active:to-emerald-800 text-white font-black py-6 rounded-3xl text-2xl shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all"
				>
					🎫 ПОЛУЧИТЬ НОВЫЙ ТАЛОН
				</button>

				{/* Logo */}
				<div className="mt-6 flex justify-center">
					<Logo />
				</div>
			</div>
		</div>
	);
}
