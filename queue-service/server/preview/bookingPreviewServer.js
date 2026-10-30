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
const path = require("path");
const Database = require("better-sqlite3");
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

// The queue directory of the sandbox lives in SQLite while the booking data
// lives in PostgreSQL, so the service rows have to be mirrored into the
// booking database before a channel can be configured for them. In the target
// application both tables live in one database and this shim is not needed.
function readQueueServices() {
	const db = new Database(
		path.join(process.env.DATA_DIR || path.join(__dirname, ".."), "queue.db"),
		{ readonly: true },
	);
	try {
		return db
			.prepare(
				"SELECT id,name,description,active,enabled FROM services WHERE active = 1",
			)
			.all();
	} finally {
		db.close();
	}
}

async function syncServices(pool) {
	const rows = readQueueServices();
	for (const s of rows) {
		await pool.query(
			`INSERT INTO services(id,name,description,active,enabled) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,active=EXCLUDED.active,enabled=EXCLUDED.enabled`,
			[s.id, s.name, s.description || null, s.active ?? 1, s.enabled ?? 1],
		);
	}
	await pool.query(
		"SELECT setval(pg_get_serial_sequence('services','id'),GREATEST((SELECT MAX(id) FROM services),1))",
	);
}

// The consent text of the widget. It is the wording of our own user
// agreement (client/src/pages/AgreementPage.jsx) and must be reviewed by a
// lawyer before the module is enabled on the production queue.
const { bookingConsent } = require("../services/bookingConsent");

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

	app.use("/api/booking", async (req, res, next) => {
		if (req.path.startsWith("/public/")) return next();
		try {
			await syncServices(pool);
		} catch (e) {
			console.warn("Не удалось синхронизировать справочник услуг:", e.message);
		}
		next();
	});

	app.use(
		"/api/booking",
		createBookingRouter({
			repository: require("../services/bookingRepository").bookingRepository(
				pool,
			),
			approvedConsent: bookingConsent,
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
