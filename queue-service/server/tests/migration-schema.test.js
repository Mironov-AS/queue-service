const { test } = require("node:test");
const assert = require("node:assert/strict");
const { audit, expected } = require("../migration/schema-audit");
function fake(tables) {
	return {
		prepare: () => ({
			all: () => Object.keys(tables).map((name) => ({ name })),
		}),
		pragma: (q) => tables[q.match(/\((.*)\)/)[1]].map((name) => ({ name })),
	};
}
test("аудит схемы принимает все ожидаемые таблицы и столбцы", () =>
	assert.equal(audit(fake(expected)).ok, true));
test("аудит останавливает перенос при неизвестной таблице или изменении столбцов", () => {
	const changed = {
		...expected,
		services: [...expected.services, "new_field"],
		extra: ["id"],
	};
	const result = audit(fake(changed));
	assert.equal(result.ok, false);
	assert.deepEqual(result.unknown, ["extra"]);
	assert.deepEqual(result.tables.services.extra, ["new_field"]);
});
test("аудит останавливает перенос при пропущенных таблицах и столбцах", () => {
	const changed = {
		...expected,
		users: expected.users.filter((x) => x !== "role"),
	};
	delete changed.tickets;
	const result = audit(fake(changed));
	assert.equal(result.ok, false);
	assert.equal(result.tables.tickets.missingTable, true);
	assert.deepEqual(result.tables.users.missing, ["role"]);
});
