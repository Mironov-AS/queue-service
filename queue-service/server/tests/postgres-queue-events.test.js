const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	createPostgresQueueEvents,
} = require("../services/postgresQueueEvents");
test("уведомления очереди разделяют публичные и административные данные", async () => {
	const sent = [];
	const io = {
		to: (room) => ({ emit: (name, data) => sent.push({ room, name, data }) }),
		except: (room) => ({
			emit: (name, data) => sent.push({ room: `except:${room}`, name, data }),
		}),
		emit: (name, data) => sent.push({ room: "all", name, data }),
	};
	const queries = [];
	const pool = { query: async (...args) => queries.push(args) };
	const state = {
		getQueueState: async () => ({ current: { name: "Тест" }, waiting: [] }),
		getPublicQueueState: async () => ({ current: { id: 1 }, waiting: [] }),
	};
	const events = createPostgresQueueEvents({ io, pool, state });
	await events.emitQueueUpdate();
	await events.emitCalled({ id: 1 });
	await events.log(
		{ user: { id: 2, username: "operator" } },
		"ticket.called",
		"#1",
	);
	assert.equal(sent[0].room, "admins");
	assert.equal(sent[0].data.current.name, "Тест");
	assert.equal(sent[1].room, "except:admins");
	assert.equal(sent[1].data.current.name, undefined);
	assert.equal(sent[2].name, "ticket:called");
	assert.deepEqual(queries[0][1], [2, "operator", "ticket.called", "#1"]);
});
