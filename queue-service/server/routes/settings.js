const express = require("express");
const db = require("../database");
const { requireAuth } = require("../middleware/requireAuth");
const { log } = require("../services/logging");

const router = express.Router();

function clampInt(val, min, max, def) {
	const n = parseInt(val, 10);
	return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

// GET /api/settings/registration
router.get("/registration", (req, res) => {
	const row = db
		.prepare("SELECT value FROM settings WHERE key = 'registration_open'")
		.get();
	res.json({ open: row?.value === "1" });
});

// PUT /api/settings/registration
router.put("/registration", requireAuth, (req, res) => {
	const { open } = req.body;
	const newVal = open ? "1" : "0";
	db.prepare(
		"UPDATE settings SET value = ? WHERE key = 'registration_open'",
	).run(newVal);
	log(req, "settings.registration", newVal === "1" ? "opened" : "closed");
	const { getIo } = require("../services/socketSetup");
	const io = getIo();
	if (io) io.emit("registration:changed", { open: newVal === "1" });
	res.json({ open: newVal === "1" });
});

// GET /api/settings/auto-open
router.get("/auto-open", requireAuth, (req, res) => {
	const enabled = db
		.prepare("SELECT value FROM settings WHERE key='auto_open_enabled'")
		.get();
	const time = db
		.prepare("SELECT value FROM settings WHERE key='auto_open_time'")
		.get();
	res.json({ enabled: enabled?.value === "1", time: time?.value || "09:00" });
});

// PUT /api/settings/auto-open
router.put("/auto-open", requireAuth, (req, res) => {
	const { enabled, time } = req.body;
	const timeVal =
		typeof time === "string" && /^\d{2}:\d{2}$/.test(time) ? time : "09:00";
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_open_enabled', ?)",
	).run(enabled ? "1" : "0");
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_open_time', ?)",
	).run(timeVal);
	log(req, "settings.auto_open", `${enabled ? "on" : "off"} at ${timeVal}`);
	res.json({ enabled: !!enabled, time: timeVal });
});

// GET /api/settings/auto-reset
router.get("/auto-reset", requireAuth, (req, res) => {
	const enabled = db
		.prepare("SELECT value FROM settings WHERE key='auto_reset_enabled'")
		.get();
	const time = db
		.prepare("SELECT value FROM settings WHERE key='auto_reset_time'")
		.get();
	res.json({ enabled: enabled?.value === "1", time: time?.value || "00:00" });
});

// PUT /api/settings/auto-reset
router.put("/auto-reset", requireAuth, (req, res) => {
	const { enabled, time } = req.body;
	const timeVal =
		typeof time === "string" && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_reset_enabled', ?)",
	).run(enabled ? "1" : "0");
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_reset_time', ?)",
	).run(timeVal);
	log(req, "settings.auto_reset", `${enabled ? "on" : "off"} at ${timeVal}`);
	res.json({ enabled: !!enabled, time: timeVal });
});

// PUT /api/settings/password
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { getJwtSecret } = require("../config");

router.put("/password", requireAuth, (req, res) => {
	const { currentPassword, newPassword } = req.body;
	const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
	if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
		return res.status(400).json({ error: "Неверный текущий пароль" });
	}
	if (!newPassword || newPassword.length < 8) {
		return res
			.status(400)
			.json({ error: "Пароль должен быть не менее 8 символов" });
	}
	db.prepare(
		"UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
	).run(bcrypt.hashSync(newPassword, 10), req.user.id);
	log(req, "settings.password_changed");
	const updatedUser = db
		.prepare("SELECT * FROM users WHERE id = ?")
		.get(req.user.id);
	const newToken = jwt.sign(
		{
			id: updatedUser.id,
			username: updatedUser.username,
			role: updatedUser.role,
			must_change_password: false,
		},
		getJwtSecret(),
		{ expiresIn: "24h" },
	);
	res.json({ success: true, token: newToken });
});

// GET /api/settings/ads
router.get("/ads", (req, res) => {
	const t = db
		.prepare("SELECT value FROM settings WHERE key='ad_ticket_display_time'")
		.get();
	const d = db
		.prepare("SELECT value FROM settings WHERE key='ad_dashboard_idle_time'")
		.get();
	const iv = db
		.prepare("SELECT value FROM settings WHERE key='ad_dashboard_interval'")
		.get();
	const ab = db
		.prepare("SELECT value FROM settings WHERE key='ad_ads_before_dashboard'")
		.get();
	const { USE_S3 } = require("../services/storage");
	res.json({
		ticket_display_time: parseInt(t?.value || "10", 10),
		dashboard_idle_time: parseInt(d?.value || "15", 10),
		dashboard_interval: parseInt(iv?.value || "0", 10),
		ads_before_dashboard: parseInt(ab?.value || "0", 10),
		s3_configured: USE_S3,
		storage_type: USE_S3 ? "s3" : "local",
	});
});

// GET /api/settings/terminal-countdown
router.get("/terminal-countdown", (req, res) => {
	const row = db
		.prepare(
			"SELECT value FROM settings WHERE key='terminal_countdown_seconds'",
		)
		.get();
	res.json({ seconds: parseInt(row?.value || "30", 10) });
});

// PUT /api/settings/terminal-countdown
router.put("/terminal-countdown", requireAuth, (req, res) => {
	const { seconds } = req.body;
	const sec = clampInt(seconds, 5, 300, 30);
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('terminal_countdown_seconds', ?)",
	).run(String(sec));
	log(req, "settings.terminal_countdown", `seconds=${sec}`);
	res.json({ seconds: sec });
});

// PUT /api/settings/ads
router.put("/ads", requireAuth, (req, res) => {
	const {
		ticket_display_time,
		dashboard_idle_time,
		dashboard_interval,
		ads_before_dashboard,
	} = req.body;
	const t = clampInt(ticket_display_time, 3, 300, 10);
	const d = clampInt(dashboard_idle_time, 3, 300, 15);
	const iv = clampInt(dashboard_interval, 0, 100, 0);
	const ab = clampInt(ads_before_dashboard, 0, 100, 0);
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_ticket_display_time', ?)",
	).run(String(t));
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_dashboard_idle_time', ?)",
	).run(String(d));
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_dashboard_interval', ?)",
	).run(String(iv));
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_ads_before_dashboard', ?)",
	).run(String(ab));
	log(
		req,
		"settings.ads",
		`ticket_display_time=${t} dashboard_idle_time=${d} dashboard_interval=${iv} ads_before_dashboard=${ab}`,
	);
	const { getIo } = require("../services/socketSetup");
	const io = getIo();
	if (io)
		io.emit("ads:config", {
			ticket_display_time: t,
			dashboard_idle_time: d,
			dashboard_interval: iv,
			ads_before_dashboard: ab,
		});
	const { USE_S3 } = require("../services/storage");
	res.json({
		ticket_display_time: t,
		dashboard_idle_time: d,
		dashboard_interval: iv,
		ads_before_dashboard: ab,
		s3_configured: USE_S3,
		storage_type: USE_S3 ? "s3" : "local",
	});
});

// GET /api/settings/field-min-length
router.get("/field-min-length", (req, res) => {
	const row = db
		.prepare("SELECT value FROM settings WHERE key = 'field_min_length'")
		.get();
	res.json({ min_length: parseInt(row?.value || "3", 10) });
});

// PUT /api/settings/field-min-length
router.put("/field-min-length", requireAuth, (req, res) => {
	const { min_length } = req.body;
	const val = clampInt(min_length, 1, 50, 3);
	db.prepare(
		"INSERT OR REPLACE INTO settings (key, value) VALUES ('field_min_length', ?)",
	).run(String(val));
	log(req, "settings.field_min_length", `set to ${val}`);
	res.json({ min_length: val });
});

module.exports = router;
