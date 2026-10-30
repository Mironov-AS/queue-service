const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { expected } = require("../migration/schema-audit");
const { rehearsalImport } = require("../migration/rehearsal-import");
const { validateTestDatabaseUrl } = require("./test-database-guard");
const url = process.env.BOOKING_TEST_DATABASE_URL;
function syntheticSource(invalid = false) {
	const records = {
		services: [{ id: 41, name: "Тест", active: 1, enabled: 1 }],
		tickets: [
			{ id: 92, number: 1, date: "2099-01-01", service_id: invalid ? 999 : 41 },
		],
		users: [{ id: 5, username: "synthetic", password_hash: "not-a-real-hash" }],
	};
	return {
		prepare(sql) {
			if (sql.includes("sqlite_master"))
				return { all: () => Object.keys(expected).map((name) => ({ name })) };
			const table = sql.match(/FROM "(\w+)"/)[1];
			return {
				iterate: function* () {
					for (const row of records[table] || [])
						yield Object.fromEntries(
							expected[table].map((c) => [c, row[c] ?? null]),
						);
				},
			};
		},
		pragma(sql) {
			return expected[sql.match(/\((.*)\)/)[1]].map((name) => ({ name }));
		},
	};
}
test("PostgreSQL: пробный перенос синтетических данных и откат при ошибке", {
	skip: !url,
	timeout: 30000,
}, async () => {
	validateTestDatabaseUrl(url, process.env.BOOKING_TEST_ISOLATION_CONFIRMED);
	const schema = `rehearsal_${crypto.randomBytes(12).toString("hex")}`;
	const pool = new Pool({
		connectionString: url,
		max: 1,
		connectionTimeoutMillis: 5000,
	});
	const client = await pool.connect();
	let created = false;
	try {
		await client.query(`CREATE SCHEMA "${schema}"`);
		created = true;
		await client.query(`SET search_path TO "${schema}"`);
		await assert.rejects(rehearsalImport(syntheticSource(true), client));
		const after = await client.query(
			"SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'",
			[schema],
		);
		assert.equal(after.rows[0].n, 0);
		const counts = await rehearsalImport(syntheticSource(), client);
		assert.equal(counts.services, 1);
		assert.equal(counts.tickets, 1);
		assert.equal(counts.users, 1);
		assert.equal(
			(await client.query("SELECT service_id FROM tickets WHERE id=92")).rows[0]
				.service_id,
			41,
		);
		assert.equal(
			(
				await client.query(
					"INSERT INTO services(name) VALUES('следующая') RETURNING id",
				)
			).rows[0].id,
			42,
		);
		await assert.rejects(rehearsalImport(syntheticSource(), client), /пустой/);
	} finally {
		if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
		client.release();
		await pool.end();
	}
});
