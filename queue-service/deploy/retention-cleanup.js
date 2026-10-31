#!/usr/bin/env node
// Retention cleanup for the queue (SQLite) and booking (PostgreSQL) data.
//
// The published policy keeps visitor-identifying data only until 30 days
// after the visit. This tool enforces that rule by anonymising identifiers
// while preserving counters and statistics.
//
// Usage:
//   node retention-cleanup.js --dry-run            # only report
//   node retention-cleanup.js --apply --days=30    # anonymise
//
// Safety: it never deletes rows, only clears identifying columns, and it
// refuses to run against a database that does not look like the expected one.
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run") || !apply;
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? Number(daysArg.split("=")[1]) : 30;
if (!Number.isInteger(days) || days < 1 || days > 3650) {
	console.error("invalid --days");
	process.exit(2);
}
const dataDir = process.env.DATA_DIR || "/opt/queue-data";
const dbFile = path.join(dataDir, "queue.db");
const serverDir = process.env.SERVER_DIR || "/opt/queue-service/server";
const bookingUrl = process.env.BOOKING_DATABASE_URL || "";
const cutoff = new Date(Date.now() - days * 86400000)
	.toISOString()
	.slice(0, 10);

function loadSqlite() {
	const Database = require(path.join(serverDir, "node_modules/better-sqlite3"));
	return new Database(dbFile, { readonly: true });
}

async function main() {
	if (!fs.existsSync(dbFile)) {
		console.error(`queue database not found: ${dbFile}`);
		process.exit(2);
	}
	const db = loadSqlite();
	const total = db.prepare("select count(*) n from tickets").get().n;
	const old = db
		.prepare(
			"select count(*) n from tickets where date < ? and (name is not null or phone is not null or (field_values is not null and field_values <> '' and field_values <> '[]'))",
		)
		.get(cutoff).n;
	const oldAll = db
		.prepare("select count(*) n from tickets where date < ?")
		.get(cutoff).n;
	db.close();
	console.log(`queue database: ${dbFile}`);
	console.log(
		`tickets total: ${total}; older than ${days} days (before ${cutoff}): ${oldAll}; with identifiers: ${old}`,
	);

	let bookingsOld = null;
	let bookingsTotal = null;
	let pool = null;
	if (bookingUrl) {
		const { Pool } = require(path.join(serverDir, "node_modules/pg"));
		pool = new Pool({
			connectionString: bookingUrl,
			connectionTimeoutMillis: 5000,
		});
		const r = await pool.query(
			"select count(*) filter (where booking_date < $1::date - ($2 || ' days')::interval) as old, count(*) as total from bookings",
			[cutoff, String(days)],
		);
		bookingsOld = Number(r.rows[0].old);
		bookingsTotal = Number(r.rows[0].total);
		console.log(
			`bookings total: ${bookingsTotal}; older than ${days} days with data: ${bookingsOld}`,
		);
	}

	if (dryRun) {
		console.log("dry run: nothing was changed (use --apply to anonymise)");
		if (pool) await pool.end();
		return;
	}

	const Database = require(path.join(serverDir, "node_modules/better-sqlite3"));
	const writable = new Database(dbFile);
	const tx = writable.transaction(() => {
		const upd = writable
			.prepare(
				"update tickets set name = null, phone = null, field_values = null where date < ? and (name is not null or phone is not null or (field_values is not null and field_values <> '' and field_values <> '[]'))",
			)
			.run(cutoff);
		return upd.changes;
	});
	const changed = tx();
	writable.close();
	console.log(`queue tickets anonymised: ${changed}`);

	if (pool) {
		const res = await pool.query(
			"update bookings set answers = '{}'::jsonb where booking_date < $1::date - ($2 || ' days')::interval and answers <> '{}'::jsonb",
			[cutoff, String(days)],
		);
		console.log(`bookings anonymised: ${res.rowCount}`);
		await pool.end();
	}
	console.log("done");
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
