// Prepares the isolated sandbox PostgreSQL database used by the booking
// preview: creates the database, applies the queue schema and the booking
// tables, and copies the sandbox service catalogue from SQLite (read-only).
//
// This never touches the production database: the target URL must point to a
// local sandbox instance and the script refuses any other host.
const fs = require("fs");
const path = require("path");
const { Client, Pool } = require("pg");
const Database = require("better-sqlite3");

const TARGET =
	process.env.PREVIEW_DATABASE_URL ||
	"postgresql://postgres@127.0.0.1:5433/queue_preview";
const ADMIN_URL =
	process.env.PREVIEW_DATABASE_ADMIN_URL ||
	"postgresql://postgres@127.0.0.1:5433/postgres";
const SQLITE_PATH =
	process.env.PREVIEW_SQLITE_PATH || path.join(__dirname, "..", "queue.db");

function assertLocal(url) {
	const parsed = new URL(url);
	if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))
		throw new Error(
			"База предпросмотра должна быть локальной: " +
				parsed.hostname +
				" не допускается",
		);
	return url;
}

async function main() {
	assertLocal(TARGET);
	assertLocal(ADMIN_URL);

	const dbName = new URL(TARGET).pathname.replace(/^\//, "");
	if (!dbName) throw new Error("Не указано имя базы предпросмотра");

	const admin = new Client({ connectionString: ADMIN_URL });
	await admin.connect();
	const exists = await admin.query(
		"SELECT 1 FROM pg_database WHERE datname=$1",
		[dbName],
	);
	if (!exists.rowCount) {
		await admin.query(`CREATE DATABASE "${dbName}"`);
		console.log(`created database ${dbName}`);
	}
	await admin.end();

	const pool = new Pool({ connectionString: TARGET });
	const schema = fs.readFileSync(
		path.join(__dirname, "..", "migration", "queue-schema.sql"),
		"utf8",
	);
	await pool.query(schema);
	const { schema: bookingSchema } = require("../services/bookingRepository");
	await pool.query(bookingSchema);

	const sqlite = new Database(SQLITE_PATH, { readonly: true });
	try {
		const services = sqlite.prepare("SELECT * FROM services").all();
		for (const s of services) {
			await pool.query(
				`INSERT INTO services(id,name,description,avg_duration_minutes,priority,daily_limit,active,enabled,created_at,is_default)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
           avg_duration_minutes=EXCLUDED.avg_duration_minutes,priority=EXCLUDED.priority,
           daily_limit=EXCLUDED.daily_limit,active=EXCLUDED.active,enabled=EXCLUDED.enabled,
           created_at=EXCLUDED.created_at,is_default=EXCLUDED.is_default`,
				[
					s.id,
					s.name,
					s.description,
					s.avg_duration_minutes,
					s.priority,
					s.daily_limit,
					s.active,
					s.enabled,
					s.created_at,
					s.is_default,
				],
			);
		}
		const fields = sqlite.prepare("SELECT * FROM service_fields").all();
		for (const f of fields) {
			await pool.query(
				`INSERT INTO service_fields(id,service_id,label,field_type,required,order_index,created_at,require_check)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
				[
					f.id,
					f.service_id,
					f.label,
					f.field_type,
					f.required,
					f.order_index,
					f.created_at,
					f.require_check || 0,
				],
			);
		}
		await pool.query(
			"SELECT setval(pg_get_serial_sequence('services','id'), COALESCE((SELECT MAX(id) FROM services),1))",
		);
		await pool.query(
			"SELECT setval(pg_get_serial_sequence('service_fields','id'), COALESCE((SELECT MAX(id) FROM service_fields),1))",
		);
		console.log(
			`synced ${services.length} services and ${fields.length} service fields`,
		);
	} finally {
		sqlite.close();
		await pool.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
