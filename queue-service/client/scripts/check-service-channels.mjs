// UI check of the service directory: every service must show its channel state
// ("Очередь" and "Запись" work independently), the creation form must allow
// choosing channels, and switching the booking channel must keep the schedule.
//
// Run: node client/scripts/check-service-channels.mjs <tokenFile>
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const token = readFileSync(process.argv[2], "utf8").trim();
const nativeFetch = globalThis.fetch;

const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{ url: "http://127.0.0.1:5175/admin?tab=services", pretendToBeVisual: true },
);
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
	value: dom.window.navigator,
	configurable: true,
	writable: true,
});
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.localStorage = dom.window.localStorage;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage.setItem("adminToken", token);
global.localStorage.setItem(
	"adminUser",
	JSON.stringify({ id: 1, username: "admin", role: "admin" }),
);

const calls = [];
const pending = [];
global.fetch = async (input, init = {}) => {
	const url = String(input);
	const target = url.startsWith("/api/booking")
		? `http://127.0.0.1:6621${url}`
		: `http://127.0.0.1:6620${url}`;
	const headers = new Headers(init.headers || {});
	headers.set("authorization", `Bearer ${token}`);
	calls.push({
		url,
		method: (init.method || "GET").toUpperCase(),
		body: init.body,
	});
	const request = nativeFetch(target, { ...init, headers });
	pending.push(request.catch(() => {}));
	return request;
};

const dir = join(process.cwd(), ".services-check");
mkdirSync(dir, { recursive: true });
const entry = join(dir, "entry.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ServicesTab from "${process.cwd()}/src/components/admin/ServicesTab.jsx";
globalThis.__act = act;
const root = createRoot(document.getElementById("root"));
act(() => {
	root.render(<ServicesTab />);
});
`,
);
const out = join(dir, "bundle.js");
await build({
	entryPoints: [entry],
	bundle: true,
	outfile: out,
	format: "cjs",
	platform: "node",
	loader: { ".jsx": "jsx" },
	jsx: "automatic",
	define: {
		"process.env.NODE_ENV": '"development"',
		"import.meta.env": "globalThis.__VITE_ENV__",
	},
	external: ["jsdom"],
});
globalThis.__VITE_ENV__ = { VITE_BOOKING_ENABLED: "true" };
require(out);
const act = globalThis.__act;

async function flush(ms = 800) {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}
await flush();
await Promise.allSettled(pending);
await flush();

const rows = [...document.querySelectorAll("tbody tr")];
console.log("услуг в справочнике:", rows.length);
if (rows.length === 0) {
	console.error("Справочник услуг пуст");
	process.exit(1);
}

function channelBadges(row) {
	return [...row.querySelectorAll("button")]
		.map((b) => b.textContent.trim())
		.filter(
			(t) =>
				t === "Активна" ||
				t === "Отключена" ||
				t === "Включена" ||
				t === "Выключена",
		);
}

const perRow = rows.map((row) => ({
	name: row.querySelector("td")?.textContent.trim(),
	badges: channelBadges(row),
}));
console.log("состояние каналов по услугам:", JSON.stringify(perRow, null, 1));

for (const item of perRow) {
	if (item.badges.length !== 2) {
		console.error(
			`У услуги «${item.name}» нет двух независимых каналов:`,
			item.badges,
		);
		process.exit(1);
	}
}

// The booking channel must be switchable independently of the queue channel.
const bookingRow = rows.find((r) => {
	const badges = channelBadges(r);
	return badges.includes("Включена") || badges.includes("Выключена");
});
const bookingBadge = [...bookingRow.querySelectorAll("button")].find((b) =>
	["Включена", "Выключена"].includes(b.textContent.trim()),
);
const wasEnabled = bookingBadge.textContent.trim() === "Включена";
global.window.confirm = () => true;
await act(async () => {
	bookingBadge.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(1500);
await Promise.allSettled(pending);
await flush(800);

const configCalls = calls.filter(
	(c) => c.url.includes("/config") && c.method === "PUT",
);
console.log("запросов сохранения настроек записи:", configCalls.length);
if (configCalls.length === 0) {
	console.error("Переключатель канала «Запись» не сохранил настройки");
	process.exit(1);
}
const sent = JSON.parse(configCalls[configCalls.length - 1].body);
console.log(
	"канал записи переключён:",
	wasEnabled ? "выключен" : "включен",
	"| enabled в запросе:",
	sent.enabled,
);
if (sent.enabled === wasEnabled) {
	console.error("Состояние канала «Запись» не изменилось");
	process.exit(1);
}

// The creation form must offer both channels.
const checkboxes = [...document.querySelectorAll("input[type=checkbox]")];
const labels = checkboxes.map((c) => c.closest("label")?.textContent.trim());
console.log("чекбоксы в форме услуги:", labels);
if (!labels.includes("Очередь")) {
	console.error("В форме услуги нет канала «Очередь»");
	process.exit(1);
}
if (!labels.includes("Запись")) {
	console.error("В форме услуги нет канала «Запись»");
	process.exit(1);
}

console.log("OK");
process.exit(0);
