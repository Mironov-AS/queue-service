import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

function localDate() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A widget link may carry an explicit date (?date=YYYY-MM-DD) so an embedder
// can link directly to a specific day. An invalid value falls back to today.
function initialDate() {
	const value = new URLSearchParams(window.location.search).get("date");
	return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : localDate();
}

export default function BookingPage() {
	const { publicId } = useParams();
	const [date, setDate] = useState(initialDate);
	const [data, setData] = useState(null);
	const [slot, setSlot] = useState("");
	const [answers, setAnswers] = useState({});
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [sending, setSending] = useState(false);
	const [receipt, setReceipt] = useState(null);
	const [revision, setRevision] = useState(0);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError("");
		setData(null);
		setSlot("");
		fetch(
			`/api/booking/public/${encodeURIComponent(publicId)}?date=${encodeURIComponent(date)}`,
			{ signal: controller.signal },
		)
			.then(async (response) => {
				if (!response.ok) {
					if (response.status === 404)
						throw new Error("Запись на эту услугу временно недоступна.");
					throw new Error(
						"Не удалось загрузить расписание. Попробуйте ещё раз.",
					);
				}
				return response.json();
			})
			.then(setData)
			.catch((err) => {
				if (err.name !== "AbortError") setError(err.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [date, publicId, revision]);

	const submit = async (event) => {
		event.preventDefault();
		if (sending || !slot || !data?.consent?.version) return;
		setSending(true);
		setError("");
		try {
			const response = await fetch(
				`/api/booking/public/${encodeURIComponent(publicId)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						date,
						start: slot,
						answers,
						consent: true,
						consentVersion: data.consent.version,
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

	return (
		<main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-800">
			<div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-lg sm:p-8">
				<p className="text-sm font-bold uppercase tracking-wider text-blue-600">
					Предварительная запись
				</p>
				<h1 className="mt-2 text-2xl font-black">
					{data?.name || "Запись на услугу"}
				</h1>
				{data?.description && (
					<p className="mt-2 text-slate-500">{data.description}</p>
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
						<label className="mt-6 block text-sm font-semibold">
							Дата
							<input
								className="mt-2 block w-full rounded-xl border border-slate-300 p-3 sm:w-auto"
								type="date"
								value={date}
								onChange={(e) => setDate(e.target.value)}
								required
							/>
						</label>
						{loading && (
							<p className="mt-5 text-slate-500" role="status">
								Загружаем расписание…
							</p>
						)}
						{error && (
							<div
								className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
								role="alert"
							>
								{error}
								{!data && (
									<button
										type="button"
										onClick={() => setRevision((n) => n + 1)}
										className="ml-2 font-bold underline"
									>
										Повторить
									</button>
								)}
							</div>
						)}
						{data && !loading && (
							<form onSubmit={submit} className="mt-6 space-y-5">
								<fieldset>
									<legend className="text-sm font-semibold">
										Выберите время{" "}
										<span className="font-normal text-slate-500">
											({data.timezone})
										</span>
									</legend>
									{data.slots.length === 0 ? (
										<p className="mt-3 text-sm text-slate-500">
											На эту дату свободных интервалов нет.
										</p>
									) : (
										<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
											{data.slots.map((s) => (
												<button
													type="button"
													key={s.start}
													disabled={s.available < 1}
													onClick={() => setSlot(s.start)}
													aria-pressed={slot === s.start}
													className={`rounded-xl border p-3 text-left text-sm ${s.available < 1 ? "cursor-not-allowed border-red-100 bg-red-50 text-red-400" : slot === s.start ? "border-blue-600 bg-blue-50 text-blue-800" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-500"}`}
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
									)}
								</fieldset>
								{data.fields.map((field) => (
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
								{data.consent?.text &&
								data.consent?.policyUrl &&
								data.consent?.consentUrl ? (
									<div className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
										<p>{data.consent.text}</p>
										<p className="mt-2">
											Нажимая «Записаться», вы соглашаетесь на обработку
											персональных данных. Ознакомьтесь с{" "}
											<a
												href={data.consent.policyUrl}
												target="_blank"
												rel="noreferrer"
												className="text-blue-700 underline"
											>
												политикой обработки персональных данных
											</a>{" "}
											и{" "}
											<a
												href={data.consent.consentUrl}
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
										!data.consent?.policyUrl ||
										!data.consent?.consentUrl
									}
									className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{sending ? "Отправляем…" : "Записаться"}
								</button>
							</form>
						)}
					</>
				)}
			</div>
		</main>
	);
}
