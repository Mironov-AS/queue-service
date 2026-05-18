const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { db, getClientSetting, setClientSetting } = require("../database");
const { requireAuth } = require("../middleware/requireAuth");
const { getJwtSecret } = require("../config");
const { log } = require("../services/logging");
const {
	makeLogoKey,
	saveLogoData,
	deleteLogoData,
} = require("../services/storage");

const router = express.Router();

// ── Logo upload ────────────────────────────────────────────────────────────────
const logoUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 5 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new Error("Только изображения: JPEG, PNG, GIF, WebP, SVG"));
		}
	},
});

function clampInt(val, min, max, def) {
	const n = parseInt(val, 10);
	return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
}

function sanitizeClientId(val) {
	if (!val || typeof val !== "string") return null;
	const trimmed = val.trim();
	return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : null;
}

async function resolveClientId(req) {
	const explicit = sanitizeClientId(req.query.client_id);
	if (explicit) return explicit;
	const token = (req.headers.authorization || "").replace("Bearer ", "");
	if (token) {
		try {
			const secret = await getJwtSecret();
			const payload = jwt.verify(token, secret);
			return payload.clientId || null;
		} catch {
			/* ignore invalid token */
		}
	}
	return null;
}

router.get("/registration", async (req, res, next) => {
	try {
		const clientId = await resolveClientId(req);
		const val = await getClientSetting("registration_open", clientId, "1");
		res.json({ open: val === "1" });
	} catch (err) {
		next(err);
	}
});

router.put("/registration", requireAuth, async (req, res, next) => {
	try {
		const { open } = req.body;
		const clientId = req.user.clientId || null;
		const newVal = open ? "1" : "0";
		await setClientSetting("registration_open", newVal, clientId);
		await log(
			req,
			"settings.registration",
			newVal === "1" ? "opened" : "closed",
		);
		const { getIo } = require("../services/socketSetup");
		const io = getIo();
		if (io && clientId)
			io.to(`admin:${clientId}`)
				.to(`public:${clientId}`)
				.emit("registration:changed", { open: newVal === "1" });
		res.json({ open: newVal === "1" });
	} catch (err) {
		next(err);
	}
});

router.get("/auto-reset", requireAuth, async (req, res, next) => {
	try {
		const clientId = req.user.clientId || null;
		const enabled = await getClientSetting("auto_reset_enabled", clientId, "0");
		const time = await getClientSetting("auto_reset_time", clientId, "00:00");
		res.json({ enabled: enabled === "1", time: time || "00:00" });
	} catch (err) {
		next(err);
	}
});

router.put("/auto-reset", requireAuth, async (req, res, next) => {
	try {
		const { enabled, time } = req.body;
		const clientId = req.user.clientId || null;
		const timeVal =
			typeof time === "string" && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
		await setClientSetting("auto_reset_enabled", enabled ? "1" : "0", clientId);
		await setClientSetting("auto_reset_time", timeVal, clientId);
		await log(
			req,
			"settings.auto_reset",
			`${enabled ? "on" : "off"} at ${timeVal}`,
		);
		res.json({ enabled: !!enabled, time: timeVal });
	} catch (err) {
		next(err);
	}
});

router.put("/password", requireAuth, async (req, res, next) => {
	try {
		const { currentPassword, newPassword } = req.body;
		const user = await db
			.prepare("SELECT * FROM users WHERE id = ?")
			.get(req.user.id);
		if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
			return res.status(400).json({ error: "Неверный текущий пароль" });
		}
		if (!newPassword || newPassword.length < 8) {
			return res
				.status(400)
				.json({ error: "Пароль должен быть не менее 8 символов" });
		}
		await db.pool.query(
			"UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2",
			[bcrypt.hashSync(newPassword, 10), req.user.id],
		);
		await log(req, "settings.password_changed");
		const updatedUser = await db
			.prepare("SELECT * FROM users WHERE id = ?")
			.get(req.user.id);
		const secret = await getJwtSecret();
		const newToken = jwt.sign(
			{
				id: updatedUser.id,
				username: updatedUser.username,
				role: updatedUser.role,
				must_change_password: false,
			},
			secret,
			{ expiresIn: "24h" },
		);
		res.json({ success: true, token: newToken });
	} catch (err) {
		next(err);
	}
});

router.get("/ads", async (req, res, next) => {
	try {
		const clientId = await resolveClientId(req);
		const t = await getClientSetting("ad_ticket_display_time", clientId, "10");
		const d = await getClientSetting("ad_dashboard_idle_time", clientId, "15");
		const iv = await getClientSetting("ad_dashboard_interval", clientId, "0");
		const ab = await getClientSetting("ad_ads_before_dashboard", clientId, "0");
		const { USE_S3 } = require("../services/storage");
		res.json({
			ticket_display_time: parseInt(t, 10),
			dashboard_idle_time: parseInt(d, 10),
			dashboard_interval: parseInt(iv, 10),
			ads_before_dashboard: parseInt(ab, 10),
			s3_configured: USE_S3,
			storage_type: USE_S3 ? "s3" : "local",
		});
	} catch (err) {
		next(err);
	}
});

router.put("/ads", requireAuth, async (req, res, next) => {
	try {
		const clientId = req.user.clientId || null;
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
		await setClientSetting("ad_ticket_display_time", String(t), clientId);
		await setClientSetting("ad_dashboard_idle_time", String(d), clientId);
		await setClientSetting("ad_dashboard_interval", String(iv), clientId);
		await setClientSetting("ad_ads_before_dashboard", String(ab), clientId);
		await log(
			req,
			"settings.ads",
			`ticket_display_time=${t} dashboard_idle_time=${d} dashboard_interval=${iv} ads_before_dashboard=${ab}`,
		);
		const { getIo } = require("../services/socketSetup");
		const io = getIo();
		if (io && clientId)
			io.to(`admin:${clientId}`)
				.to(`public:${clientId}`)
				.emit("ads:config", {
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
	} catch (err) {
		next(err);
	}
});

router.get("/windows", async (req, res, next) => {
	try {
		const clientId = await resolveClientId(req);
		const val = await getClientSetting("windows_count", clientId, "1");
		res.json({ windows_count: Math.max(1, parseInt(val, 10) || 1) });
	} catch (err) {
		next(err);
	}
});

router.put("/windows", requireAuth, async (req, res, next) => {
	try {
		const clientId = req.user.clientId || null;
		if (!clientId)
			return res
				.status(400)
				.json({
					error:
						"Настройки окон доступны только в контексте клиента (требуется SSO-авторизация)",
				});
		const count = clampInt(req.body.windows_count, 1, 20, 1);
		await setClientSetting("windows_count", String(count), clientId);
		await log(req, "settings.windows", `windows_count=${count}`);
		const { getIo } = require("../services/socketSetup");
		const io = getIo();
		if (io)
			io.to(`admin:${clientId}`)
				.to(`public:${clientId}`)
				.emit("windows:updated", { windows_count: count });
		res.json({ windows_count: count });
	} catch (err) {
		next(err);
	}
});

// ── Logo settings ──────────────────────────────────────────────────────────────
// Logo is stored as binary BYTEA in PostgreSQL (logo_blobs table) and the
// key (filename) is tracked in settings (dashboard_logo_key).
// GET /logo      → returns { logo_key, logo_url } (logo_url = /api/settings/logo/data)
// POST /logo      → saves binary to DB
// GET /logo/data  → streams raw binary with correct Content-Type (used by <img>)
// DELETE /logo    → removes from DB

router.get("/logo", async (req, res, next) => {
	try {
		const clientId = await resolveClientId(req);
		const logoKey = await getClientSetting(
			"dashboard_logo_key",
			clientId,
			null,
		);
		res.json({ logo_key: logoKey, logo_url: logoKey ? `/api/settings/logo/data` : null });
	} catch (err) {
		next(err);
	}
});

router.post(
	"/logo",
	requireAuth,
	logoUpload.single("file"),
	async (req, res, next) => {
		try {
			const clientId = req.user.clientId || null;
			if (!req.file) return res.status(400).json({ error: "Файл не загружен" });


			const oldKey = await getClientSetting(
				"dashboard_logo_key",
				clientId,
				null,
			);
			if (oldKey) {
				await deleteLogoData(oldKey).catch(() => {});
			}

			const newKey = makeLogoKey(
				req.file.originalname.split(".").pop(),
			);
			await saveLogoData(newKey, req.file.buffer, req.file.mimetype);
			await setClientSetting("dashboard_logo_key", newKey, clientId);
			await log(req, "settings.logo_uploaded", newKey);

			res.json({ logo_key: newKey, logo_url: `/api/settings/logo/data` });
		} catch (err) {
			next(err);
		}
	},
);

// Serve logo binary directly — no file system / nginx alias needed
router.get("/logo/data", async (req, res, next) => {
	try {
		const clientId = await resolveClientId(req);
		const logoKey = await getClientSetting(
			"dashboard_logo_key",
			clientId,
			null,
		);
		if (!logoKey) return res.status(404).json({ error: "Логотип не установлен" });


		const { getLogoData } = require("../services/storage");
		const logoData = await getLogoData(logoKey);
		if (!logoData) return res.status(404).json({ error: "Логотип не найден" });

		res.setHeader("Content-Type", logoData.mimetype);
		res.setHeader("Cache-Control", "private, max-age=3600");
		res.send(logoData.buffer);
	} catch (err) {
		next(err);
	}
});

router.delete("/logo", requireAuth, async (req, res, next) => {
	try {
		const clientId = req.user.clientId || null;
		const oldKey = await getClientSetting(
			"dashboard_logo_key",
			clientId,
			null,
		);
		if (oldKey) {
			await deleteLogoData(oldKey).catch(() => {});
			await setClientSetting("dashboard_logo_key", "", clientId);
			await log(req, "settings.logo_deleted", oldKey);
		}
		res.json({ success: true });
	} catch (err) {
		next(err);
	}
});

module.exports = router;
