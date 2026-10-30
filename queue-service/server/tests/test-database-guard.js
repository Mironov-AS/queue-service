// Guardrails, not proof that a target is safe: inspect the endpoint independently.
function validateTestDatabaseUrl(connectionString, confirmation) {
	if (confirmation !== "isolated-test-only")
		throw new Error(
			"Для интеграционного теста требуется явное подтверждение изоляции БД",
		);
	let url;
	try {
		url = new URL(connectionString);
	} catch {
		throw new Error("Некорректный адрес тестовой PostgreSQL");
	}
	if (
		!["postgres:", "postgresql:"].includes(url.protocol) ||
		!url.hostname ||
		url.hash ||
		url.search
	)
		throw new Error("Некорректный адрес тестовой PostgreSQL");
	let name;
	try {
		name = decodeURIComponent(url.pathname.slice(1));
	} catch {
		throw new Error("Некорректное имя тестовой базы");
	}
	if (!/^test_[a-z0-9_]+$/i.test(name))
		throw new Error("Имя изолированной тестовой БД должно начинаться с test_");
	return true;
}
module.exports = { validateTestDatabaseUrl };
