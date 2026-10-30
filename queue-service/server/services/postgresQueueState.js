// PostgreSQL queue state reader; not yet wired into the legacy server.
function parseTicket(ticket) {
	if (!ticket) return null;
	return {
		...ticket,
		field_values: ticket.field_values ? JSON.parse(ticket.field_values) : [],
	};
}
function createPostgresQueueState(
	pool,
	clock = () => new Date().toISOString().slice(0, 10),
) {
	if (!pool || typeof pool.query !== "function")
		throw new Error("Требуется подключение PostgreSQL");
	async function getQueueState() {
		const date = clock();
		const result = await pool.query(
			`SELECT t.*, s.name AS service_name, s.avg_duration_minutes
   FROM tickets t LEFT JOIN services s ON t.service_id=s.id
   WHERE t.date=$1 AND t.status IN ('called','waiting')
   ORDER BY CASE WHEN t.status='called' THEN 0 ELSE 1 END,
    CASE WHEN t.status='called' THEN t.called_at END DESC,
    t.is_priority DESC, t.created_at ASC, t.id ASC`,
			[date],
		);
		const current = result.rows.find((t) => t.status === "called");
		return {
			current: parseTicket(current),
			waiting: result.rows
				.filter((t) => t.status === "waiting")
				.map(parseTicket),
		};
	}
	async function getPublicQueueState() {
		const state = await getQueueState();
		// Preserve existing API contract during migration; privacy hardening needs a
		// separate compatibility review before changing publicly displayed fields.
		const publicTicket = (t) =>
			t
				? {
						id: t.id,
						number: t.number,
						service_name: t.service_name,
						status: t.status,
						called_at: t.called_at,
						is_priority: t.is_priority,
						field_values: t.field_values || [],
					}
				: null;
		return {
			current: publicTicket(state.current),
			waiting: state.waiting.map(publicTicket),
		};
	}
	return { getQueueState, getPublicQueueState };
}
module.exports = { createPostgresQueueState };
