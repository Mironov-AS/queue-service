// Isolated PostgreSQL implementation; not connected to the SQLite server.
// All future write paths for a queue day must use the same advisory lock.
function createPostgresQueueActions(
	pool,
	clock = () => new Date().toISOString().slice(0, 10),
) {
	if (!pool || typeof pool.connect !== "function")
		throw new Error("Требуется пул PostgreSQL");
	async function call(id = null) {
		if (id !== null && (!Number.isSafeInteger(id) || id < 1))
			throw new Error("Некорректный id");
		const date = clock();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT pg_advisory_xact_lock(hashtext('queue-service:queue-day'), hashtext($1))",
				[date],
			);
			const next = await client.query(
				`SELECT id FROM tickets WHERE date=$1 AND status='waiting'
    AND ($2::integer IS NULL OR id=$2) ORDER BY is_priority DESC,created_at ASC,id ASC LIMIT 1 FOR UPDATE`,
				[date, id],
			);
			// Calling a nonexistent specific ticket must not finish the current ticket.
			if (id !== null && next.rowCount === 0) {
				await client.query("COMMIT");
				return null;
			}
			await client.query(
				"UPDATE tickets SET status='served', served_at=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=(SELECT id FROM tickets WHERE date=$1 AND status='called' LIMIT 1)",
				[date],
			);
			if (next.rowCount === 0) {
				await client.query("COMMIT");
				return null;
			}
			const updated = await client.query(
				`UPDATE tickets SET status='called',called_at=to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=$1 RETURNING *`,
				[next.rows[0].id],
			);
			const service = await client.query(
				"SELECT name AS service_name FROM services WHERE id=$1",
				[updated.rows[0].service_id],
			);
			await client.query("COMMIT");
			return {
				...updated.rows[0],
				service_name: service.rows[0]?.service_name ?? null,
			};
		} catch (e) {
			await client.query("ROLLBACK");
			throw e;
		} finally {
			client.release();
		}
	}
	return { callNext: () => call(), callSpecific: (id) => call(id) };
}
module.exports = { createPostgresQueueActions };
