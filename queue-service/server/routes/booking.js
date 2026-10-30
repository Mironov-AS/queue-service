const express = require("express");
const rateLimit = require("express-rate-limit");
const { calculateSlots } = require("../services/bookingSlots");

// The caller must provide a server-controlled, legally reviewed consent document.
// This router is intentionally not mounted in the legacy SQLite server.
function validDocumentUrl(value) {
	if (typeof value !== "string" || !value.trim()) return false;
	if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"))
		return true;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}
function createBookingRouter({
	repository,
	approvedConsent,
	requireAuth,
	requireAdmin,
}) {
	if (typeof requireAuth !== "function" || typeof requireAdmin !== "function")
		throw new Error("Необходимо настроить защиту админки");
	if (
		!repository ||
		!approvedConsent ||
		typeof approvedConsent.version !== "string" ||
		typeof approvedConsent.text !== "string" ||
		!approvedConsent.version.trim() ||
		!approvedConsent.text.trim() ||
		!validDocumentUrl(approvedConsent.policyUrl) ||
		!validDocumentUrl(approvedConsent.consentUrl)
	)
		throw new Error("Необходимо настроить утверждённое согласие");
	const router = express.Router();
	const publicLimit = rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 120,
		standardHeaders: true,
		legacyHeaders: false,
	});
	const uuid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const id = (value) =>
		/^[1-9]\d{0,9}$/.test(String(value)) && Number.isSafeInteger(Number(value))
			? Number(value)
			: null;
	const date = (value) => {
		try {
			calculateSlots({
				date: value,
				weekdays: [],
				durationMinutes: 1,
				capacity: 1,
			});
			return value;
		} catch {
			return null;
		}
	};
	const month = (value) => {
		if (value === undefined || value === null || value === "") return null;
		return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)) ? String(value) : null;
	};
	const handle = (fn) => async (req, res) => {
		try {
			await fn(req, res);
		} catch (e) {
			// Only known validation messages may cross the API boundary.
			// Database drivers also emit connection and operational errors without SQLSTATE.
			const validation =
				/^(Некорректн|Слишком много полей формы|Слишком длинное значение поля|Неизвестное поле формы|Заполните поле: |Необходимо утверждённое согласие|Запись временно недоступна|Нельзя записаться в прошедшее время|Время недоступно)/;
			if (e instanceof Error && !e.code && validation.test(e.message)) {
				return res.status(400).json({ error: e.message });
			}
			console.error(
				"booking operation error:",
				e?.code || e?.name || "unknown",
			);
			return res.status(500).json({ error: "Ошибка сервера" });
		}
	};
	router.get(
		"/public/:publicId",
		publicLimit,
		handle(async (req, res) => {
			if (!uuid.test(req.params.publicId) || !date(req.query.date))
				return res.status(400).json({ error: "Некорректные параметры" });
			const data = await repository.getPublic(
				req.params.publicId,
				req.query.date,
			);
			if (!data)
				return res
					.status(404)
					.json({ error: "Запись на эту услугу временно недоступна" });
			return res.json({
				...data,
				consent: {
					version: approvedConsent.version,
					text: approvedConsent.text,
					policyUrl: approvedConsent.policyUrl,
					consentUrl: approvedConsent.consentUrl,
				},
			});
		}),
	);
	router.get(
		"/public/:publicId/month",
		publicLimit,
		handle(async (req, res) => {
			if (!uuid.test(req.params.publicId))
				return res.status(400).json({ error: "Некорректные параметры" });
			const requested = month(req.query.month);
			if (req.query.month !== undefined && !requested)
				return res.status(400).json({ error: "Некорректные параметры" });
			const data = await repository.getAvailability(
				req.params.publicId,
				requested,
			);
			if (!data)
				return res
					.status(404)
					.json({ error: "Запись на эту услугу временно недоступна" });
			return res.json({
				...data,
				consent: {
					version: approvedConsent.version,
					text: approvedConsent.text,
					policyUrl: approvedConsent.policyUrl,
					consentUrl: approvedConsent.consentUrl,
				},
			});
		}),
	);
	router.post(
		"/public/:publicId",
		publicLimit,
		handle(async (req, res) => {
			if (!uuid.test(req.params.publicId) || !date(req.body.date))
				return res.status(400).json({ error: "Некорректные параметры" });
			if (req.body.consentVersion !== approvedConsent.version)
				return res
					.status(409)
					.json({ error: "Текст согласия изменился, обновите форму" });
			const booking = await repository.create(
				req.params.publicId,
				req.body,
				approvedConsent,
			);
			return res.status(201).json(booking);
		}),
	);
	router.get(
		"/services",
		requireAuth,
		requireAdmin,
		handle(async (_req, res) => {
			return res.json({ services: await repository.getServiceChannels() });
		}),
	);
	router.get(
		"/services/:serviceId/config",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId);
			if (!serviceId)
				return res.status(400).json({ error: "Некорректная услуга" });
			return res.json(await repository.getConfig(serviceId));
		}),
	);
	router.put(
		"/services/:serviceId/config",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId);
			if (!serviceId)
				return res.status(400).json({ error: "Некорректная услуга" });
			return res.json(await repository.saveConfig(serviceId, req.body));
		}),
	);
	router.get(
		"/services/:serviceId/calendar",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId);
			if (!serviceId || !date(req.query.date))
				return res.status(400).json({ error: "Некорректные параметры" });
			const calendar = await repository.getCalendar(serviceId, req.query.date);
			return calendar
				? res.json(calendar)
				: res.status(404).json({ error: "Расписание не настроено" });
		}),
	);
	router.get(
		"/services/:serviceId/month",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId);
			if (!serviceId)
				return res.status(400).json({ error: "Некорректная услуга" });
			const month = String(req.query.month || "");
			if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
				return res.status(400).json({ error: "Некорректный месяц" });
			const month1 = await repository.getAdminMonth(serviceId, month);
			return month1
				? res.json(month1)
				: res.status(404).json({ error: "Расписание не настроено" });
		}),
	);
	router.get(
		"/services/:serviceId/bookings",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId);
			if (!serviceId)
				return res.status(400).json({ error: "Некорректная услуга" });
			const month = String(req.query.month || "");
			if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
				return res.status(400).json({ error: "Некорректный месяц" });
			const list = await repository.getAdminBookings(serviceId, month);
			return list
				? res.json(list)
				: res.status(404).json({ error: "Расписание не настроено" });
		}),
	);
	router.post(
		"/services/:serviceId/bookings/:bookingId/cancel",
		requireAuth,
		requireAdmin,
		handle(async (req, res) => {
			const serviceId = id(req.params.serviceId),
				bookingId = id(req.params.bookingId);
			if (!serviceId || !bookingId)
				return res.status(400).json({ error: "Некорректные параметры" });
			return (await repository.cancel(serviceId, bookingId))
				? res.json({ cancelled: true })
				: res.status(404).json({ error: "Запись не найдена" });
		}),
	);
	return router;
}
module.exports = { createBookingRouter };
