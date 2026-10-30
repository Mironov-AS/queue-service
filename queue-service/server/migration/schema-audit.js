// Inspect an existing source read-only. No data rows or secrets are emitted.
const Database = require("better-sqlite3");
const expected = {
	services: [
		"id",
		"name",
		"description",
		"avg_duration_minutes",
		"priority",
		"daily_limit",
		"active",
		"enabled",
		"created_at",
		"is_default",
	],
	tickets: [
		"id",
		"number",
		"date",
		"service_id",
		"status",
		"is_priority",
		"name",
		"phone",
		"skip_reason",
		"cancel_reason",
		"created_at",
		"called_at",
		"served_at",
		"field_values",
	],
	users: [
		"id",
		"username",
		"password_hash",
		"role",
		"created_at",
		"must_change_password",
	],
	action_logs: ["id", "user_id", "username", "action", "details", "created_at"],
	settings: ["key", "value"],
	service_fields: [
		"id",
		"service_id",
		"label",
		"field_type",
		"required",
		"order_index",
		"created_at",
		"require_check",
	],
	advertisements: [
		"id",
		"name",
		"file_key",
		"file_type",
		"mime_type",
		"duration",
		"order_index",
		"active",
		"created_at",
		"owner_id",
		"owner_username",
		"status",
	],
	schema_migrations: ["version", "name", "applied_at"],
};
function audit(db) {
	const tables = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
		)
		.all()
		.map((x) => x.name);
	const unknown = tables.filter((t) => !Object.hasOwn(expected, t));
	const report = { unknown, tables: {}, ok: unknown.length === 0 };
	for (const [table, columns] of Object.entries(expected)) {
		if (!tables.includes(table)) {
			report.tables[table] = { missingTable: true };
			report.ok = false;
			continue;
		}
		const actual = db.pragma(`table_info(${table})`).map((x) => x.name);
		const missing = columns.filter((x) => !actual.includes(x));
		const extra = actual.filter((x) => !columns.includes(x));
		report.tables[table] = { missing, extra };
		if (missing.length || extra.length) report.ok = false;
	}
	return report;
}
if (require.main === module) {
	const file = process.argv[2];
	if (!file) {
		console.error("Укажите путь к существующей копии базы");
		process.exit(2);
	}
	const db = new Database(file, { readonly: true, fileMustExist: true });
	try {
		const r = audit(db);
		console.log(JSON.stringify(r, null, 2));
		if (!r.ok) process.exitCode = 1;
	} finally {
		db.close();
	}
}
module.exports = { audit, expected };
