// Standalone PostgreSQL queue router. Not mounted by the SQLite server.
const express = require("express");
function createPostgresQueueRouter({
	state,
	actions,
	requireAuth,
	emitQueueUpdate,
	emitCalled,
	log,
}) {
	if (
		!state ||
		!actions ||
		typeof requireAuth !== "function" ||
		typeof emitQueueUpdate !== "function" ||
		typeof emitCalled !== "function" ||
		typeof log !== "function"
	)
		throw new Error("Не заданы зависимости очереди");
	const router = express.Router();
	const wrap = (fn) => (req, res, next) =>
		Promise.resolve()
			.then(() => fn(req, res))
			.catch(next);
	const idOf = (value) => {
		const n = Number(value);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	};
	// Side effects happen after the database transaction commits. Report their
	// failure separately: returning 500 would invite replay of a completed action.
	const attempt = async (fn) => { try { await fn(); return false; } catch { return true; } };
	const updated = async (res, extra = {}, warning = false) => {
		warning = await attempt(emitQueueUpdate) || warning;
		let queue;
		try { queue = await state.getQueueState(); } catch { warning = true; }
		res.json({ ...extra, ...(queue || {}), ...(warning ? { warning: 'Операция выполнена, но обновление или журнал недоступны; проверьте состояние очереди' } : {}) });
	};
	router.get(
		"/",
		wrap(async (req, res) => res.json(await state.getPublicQueueState())),
	);
	router.get(
		"/full",
		requireAuth,
		wrap(async (req, res) => res.json(await state.getQueueState())),
	);
	router.post(
		"/next",
		requireAuth,
		wrap(async (req, res) => {
			const ticket = await actions.callNext();
            let warning = false;
			if (ticket) {
				warning = await attempt(() => emitCalled(ticket)) || warning;
                warning = await attempt(() => log(req, "ticket.called", `#${ticket.number}`)) || warning;
			}
			await updated(res, {}, warning);
		}),
	);
	router.post(
		"/call/:id",
		requireAuth,
		wrap(async (req, res) => {
			const id = idOf(req.params.id);
			if (!id) return res.status(400).json({ error: "Некорректный id" });
			const ticket = await actions.callSpecific(id);
			if (!ticket)
				return res.status(404).json({ error: "Талон не найден в очереди" });
			let warning = await attempt(() => emitCalled(ticket));
            warning = await attempt(() => log(req, "ticket.called", `#${ticket.number}`)) || warning;
			await updated(res, {}, warning);
		}),
	);
	router.post(
		"/repeat",
		requireAuth,
		wrap(async (req, res) => {
			const current = (await state.getQueueState()).current;
			if (current) {
				await emitCalled(current);
				await log(req, "ticket.called.repeat", `#${current.number}`);
			}
			await updated(res);
		}),
	);
	router.post(
		"/return",
		requireAuth,
		wrap(async (req, res) => {
			const ticket = await actions.returnCurrent();
			const warning = ticket ? await attempt(() => log(req, "ticket.returned", `#${ticket.number}`)) : false;
			await updated(res, {}, warning);
		}),
	);
	router.post(
		"/return/:id",
		requireAuth,
		wrap(async (req, res) => {
			const id = idOf(req.params.id);
			if (!id) return res.status(400).json({ error: "Неверный id талона" });
			const result = await actions.returnSpecific(id);
			if (result.result === "not_found")
				return res.status(404).json({ error: "Талон не найден" });
			if (result.result === "already_waiting")
				return res.status(400).json({ error: "Талон уже в очереди" });
			const warning = await attempt(() => log(req, "ticket.returned", `#${result.ticket.number}`));
			await updated(res, { success: true }, warning);
		}),
	);
	router.post(
		"/return-all",
		requireAuth,
		wrap(async (req, res) => {
			const count = await actions.returnAll();
			const warning = await attempt(() => log(req, "queue.return_all", `${count} талонов возвращено в очередь`));
			await updated(res, { success: true, returned: count }, warning);
		}),
	);
	const complete = wrap(async (req, res) => {
		const ticket = await actions.complete(req.body?.reason);
		const warning = ticket ? await attempt(() => log(req, "ticket.served", `#${ticket.number}`)) : false;
		await updated(res, {}, warning);
	});
	for (const endpoint of ["/complete", "/skip", "/cancel-current"])
		router.post(endpoint, requireAuth, complete);
	router.post(
		"/reset",
		requireAuth,
		wrap(async (req, res) => {
			await actions.reset();
			let warning = await attempt(() => log(req, "queue.reset", ""));
            warning = await attempt(emitQueueUpdate) || warning;
			res.json({ success: true, ...(warning ? {warning: "Операция выполнена, но обновление или журнал недоступны; проверьте состояние очереди"} : {}) });
		}),
	);
	return router;
}
module.exports = { createPostgresQueueRouter };
