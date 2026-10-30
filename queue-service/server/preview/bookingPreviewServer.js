// Sandbox-only preview server for the booking module.
//
// The legacy queue service keeps running on SQLite and is not modified. This
// process serves only /api/booking from an isolated PostgreSQL database that
// lives inside the sandbox (127.0.0.1, never reachable from outside).
//
// It is a preview harness, not a production deployment: the consent document
// below is a technical placeholder and must be replaced by a legally reviewed
// version before any real use.
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { createBookingRouter } = require("../routes/booking");

const PORT = Number(process.env.PREVIEW_PORT || 6621);
const DATABASE_URL =
	process.env.PREVIEW_DATABASE_URL ||
	"postgresql://postgres@127.0.0.1:5433/queue_preview";

// The preview reuses the sandbox queue secret so the admin token issued by
// the legacy SQLite login is accepted here without a second login.
function jwtSecret() {
	if (process.env.PREVIEW_JWT_SECRET) return process.env.PREVIEW_JWT_SECRET;
	const Database = require("better-sqlite3");
	const path = require("path");
	const db = new Database(
		path.join(process.env.DATA_DIR || path.join(__dirname, ".."), "queue.db"),
		{ readonly: true },
	);
	try {
		const row = db
			.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'")
			.get();
		if (row && row.value) return row.value;
	} finally {
		db.close();
	}
	throw new Error("Не удалось получить секрет JWT из песочницы");
}

function requireAuth(req, res, next) {
	const token = (req.headers.authorization || "").replace("Bearer ", "");
	if (!token) return res.status(401).json({ error: "Не авторизован" });
	try {
		req.user = jwt.verify(token, jwtSecret());
		next();
	} catch {
		res.status(401).json({ error: "Недействительный токен" });
	}
}

function requireAdmin(req, res, next) {
	if (req.user?.role !== "admin")
		return res.status(403).json({ error: "Доступ запрещён" });
	next();
}

// Placeholder only. The wording, version and links must be reviewed by the
// customer before the module is enabled anywhere real.
const previewConsent = {
	version: "preview-2026-10-30",
	text:
		"Технический текст для проверки в песочнице: нажимая кнопку «Записаться», " +
		"вы передаёте указанные данные для предварительной записи. Этот текст не является " +
		"утверждённым документом и используется только для проверки работы формы.",
	policyUrl: "/privacy",
	consentUrl: "/consent",
};

async function main() {
	const pool = new Pool({ connectionString: DATABASE_URL });
	const app = express();
	app.set("trust proxy", 1);
	app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
	app.use(express.json({ limit: "100kb" }));

	app.get("/health", async (_req, res) => {
		try {
			await pool.query("SELECT 1");
			res.json({ status: "ok", database: "postgresql" });
		} catch (e) {
			res.status(503).json({ status: "error", error: e.code || e.name });
		}
	});

	app.use(
		"/api/booking",
		createBookingRouter({
			repository: require("../services/bookingRepository").bookingRepository(pool),
			approvedConsent: previewConsent,
			requireAuth,
			requireAdmin,
		}),
	);

	app.use((_req, res) => res.status(404).json({ error: "Не найдено" }));

	app.listen(PORT, "0.0.0.0", () => {
		console.log(`Booking preview on http://0.0.0.0:${PORT}`);
	});
}

main().catch((e) => {
	console.error("Booking preview failed:", e);
	process.exit(1);
});
