// Rehearsal only. The caller must provide a read-only, consistent SQLite snapshot
// and an isolated PostgreSQL client. Never invoke against live production data.
const fs = require("node:fs");
const path = require("node:path");
const { audit, expected } = require("./schema-audit");
const tables = [
	"services",
	"users",
	"tickets",
	"action_logs",
	"settings",
	"service_fields",
	"advertisements",
	"schema_migrations",
];
const identityTables = [
	"services",
	"users",
	"tickets",
	"action_logs",
	"service_fields",
	"advertisements",
];
const quote = (s) => `"${s.replace(/"/g, '""')}"`;

async function rehearsalImport(source, client) {
	if (!audit(source).ok)
		throw new Error("Исходная схема не соответствует ожидаемой");
	const counts = {};
	await client.query("BEGIN");
	try {
		const occupied = await client.query(
			"SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','S','f')",
		);
		if (occupied.rows[0].n !== 0)
			throw new Error("Целевая схема должна быть пустой");
		await client.query(
			fs.readFileSync(path.join(__dirname, "queue-schema.sql"), "utf8"),
		);
		for (const table of tables) {
			const columns = expected[table];
			const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`;
			let count = 0;
			// The source must remain in one read transaction for the entire import.
			for (const row of source
				.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}`)
				.iterate()) {
				await client.query(
					sql,
					columns.map((c) => row[c]),
				);
				count++;
			}
			const result = await client.query(
				`SELECT count(*)::int AS n FROM ${quote(table)}`,
			);
			if (result.rows[0].n !== count)
				throw new Error(`Несовпадение количества: ${table}`);
			counts[table] = count;
		}
		for (const table of identityTables) {
			await client.query(
				`SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE((SELECT max(id) FROM ${quote(table)}),1),EXISTS(SELECT 1 FROM ${quote(table)}))`,
				[table],
			);
		}
		await client.query("COMMIT");
		return counts;
	} catch (e) {
		await client.query("ROLLBACK");
		throw e;
	}
}
module.exports = { rehearsalImport };
