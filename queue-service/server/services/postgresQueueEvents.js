// Adapter for the future PostgreSQL runtime; intentionally not mounted on SQLite.
function createPostgresQueueEvents({ io, state, pool }) {
	if (!io || !state || !pool)
		throw new Error("Не заданы зависимости уведомлений");
	return {
		async emitQueueUpdate() {
			const [full, publicState] = await Promise.all([
				state.getQueueState(),
				state.getPublicQueueState(),
			]);
			io.to("admins").emit("queue:updated", full);
			io.except("admins").emit("queue:updated", publicState);
		},
		async emitCalled(ticket) {
			io.emit("ticket:called", ticket);
		},
		async log(req, action, details = "") {
			await pool.query(
				"INSERT INTO action_logs (user_id,username,action,details) VALUES ($1,$2,$3,$4)",
				[
					req.user?.id || null,
					req.user?.username || "visitor",
					action,
					details,
				],
			);
		},
	};
}
module.exports = { createPostgresQueueEvents };
