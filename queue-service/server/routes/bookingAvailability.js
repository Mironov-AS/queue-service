const express = require("express");

// Fail closed: a separate UI build flag is not an authorization boundary.
// An enabled router must be passed explicitly by the future PostgreSQL application;
// it must never be attached to the legacy SQLite service.
function createBookingAvailability({ enabled = false, bookingRouter } = {}) {
	if (enabled && typeof bookingRouter !== "function") {
		throw new Error(
			"Нельзя включить запись без подключённого маршрутизатора PostgreSQL",
		);
	}
	const router = express.Router();
	if (enabled) router.use(bookingRouter);
	else
		router.use((_req, res) =>
			res.status(503).json({ error: "Запись временно недоступна" }),
		);
	return router;
}
module.exports = { createBookingAvailability };
