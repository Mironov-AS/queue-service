// Consistency check of legal document versions.
//
// The version recorded with every booking (server) must be the same version
// that the public pages show. A mismatch means a visitor accepted one text
// while the site displays another.
//
// Run: node client/scripts/check-legal-versions.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(process.cwd(), "client");
const root = join(projectRoot, "src");
const read = (p) => readFileSync(join(root, p), "utf8");

const agreement = read("pages/AgreementPage.jsx");
const legal = read("pages/legal-v3.json");
const consentModule = readFileSync(
	join(projectRoot, "..", "server", "services", "bookingConsent.js"),
	"utf8",
);

const clientVersion = (agreement.match(/AGREEMENT_VERSION\s*=\s*"([^"]+)"/) ||
	[])[1];
const clientLabel = (agreement.match(/AGREEMENT_UPDATED\s*=\s*"([^"]+)"/) ||
	[])[1];
const serverVersion = (consentModule.match(/version:\s*"([^"]+)"/) || [])[1];
const legalVersions = [
	...legal.matchAll(/agreement-\d{4}-\d{2}-\d{2}-v\d+/g),
].map((m) => m[0]);

const problems = [];
if (!clientVersion)
	problems.push("в AgreementPage.jsx не найдена AGREEMENT_VERSION");
if (!serverVersion) problems.push("в bookingConsent.js не найден version");
if (clientVersion && serverVersion && clientVersion !== serverVersion) {
	problems.push(
		`версия клиента ${clientVersion} != версия сервера ${serverVersion}`,
	);
}
if (clientVersion && legalVersions.some((v) => v !== clientVersion)) {
	problems.push(
		`в legal-v3.json встречаются другие версии: ${legalVersions.join(", ")}`,
	);
}
if (clientVersion && clientLabel) {
	const labelVersion = (clientLabel.match(/\((v\d+)\)/) || [])[1];
	const expected = "v" + (clientVersion.match(/-v(\d+)$/) || [])[1];
	if (labelVersion && labelVersion !== expected) {
		problems.push(
			`подпись «${clientLabel}» не соответствует версии ${clientVersion}`,
		);
	}
}
if (problems.length) {
	console.error("Версии юридических документов расходятся:");
	for (const p of problems) console.error(" - " + p);
	process.exit(1);
}
console.log(
	`OK: версия ${clientVersion}, подпись «${clientLabel}», сервер ${serverVersion}, legal-v3.json ${[...new Set(legalVersions)].join(", ")}`,
);
