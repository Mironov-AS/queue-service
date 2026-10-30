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
			// Visitors need only the identifier; the public display uses number and service.
			// Never broadcast names, phones, arbitrary form values or reasons.
			const publicTicket = {
				id: ticket.id,
				number: ticket.number,
				service_name: ticket.service_name,
				status: ticket.status,
				called_at: ticket.called_at,
			};
			io.to("admins").emit("ticket:called", ticket);
			io.except("admins").emit("ticket:called", publicTicket);
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
