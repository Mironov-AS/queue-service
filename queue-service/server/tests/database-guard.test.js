const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateTestDatabaseUrl } = require("./test-database-guard");
test("интеграционный тест требует явное подтверждение и имя отдельной тестовой базы", () => {
	const yes = "isolated-test-only";
	assert.equal(
		validateTestDatabaseUrl("postgresql://localhost/test_queue", yes),
		true,
	);
	for (const url of [
		"postgresql://localhost/queue",
		"postgresql://localhost/test_queue?host=other",
		"https://localhost/test_queue",
		"postgresql://localhost/test_%2Fqueue",
		"not-a-url",
	])
		assert.throws(() => validateTestDatabaseUrl(url, yes));
	assert.throws(() =>
		validateTestDatabaseUrl("postgresql://localhost/test_queue", ""),
	);
});
