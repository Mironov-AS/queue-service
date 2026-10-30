// UI check of the admin panel header: an administrator must see the "Запись"
// tab next to "Очередь", and the tab must open the month calendar.
//
// Run: node client/scripts/check-admin-tabs.mjs <tokenFile>
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const token = readFileSync(process.argv[2], "utf8").trim();
const role = process.argv[3] || "admin";
const nativeFetch = globalThis.fetch;

const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{ url: "http://127.0.0.1:5175/admin?tab=queue", pretendToBeVisual: true },
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
	JSON.stringify({ id: 1, username: role, role }),
);
const pending = [];
global.fetch = async (input, init = {}) => {
	const url = String(input);
	const target = url.startsWith("/api/booking")
		? `http://127.0.0.1:6621${url}`
		: `http://127.0.0.1:6620${url}`;
	const headers = new Headers(init.headers || {});
	headers.set("authorization", `Bearer ${token}`);
	const request = nativeFetch(target, { ...init, headers });
	pending.push(request.catch(() => {}));
	return request;
};

const dir = join(process.cwd(), ".admin-tabs-check");
mkdirSync(dir, { recursive: true });
const entry = join(dir, "entry.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import AdminPage from "${process.cwd()}/src/pages/AdminPage.jsx";
globalThis.__act = act;
const root = createRoot(document.getElementById("root"));
act(() => {
	root.render(
		<MemoryRouter initialEntries={["/admin?tab=booking"]}>
			<AdminPage />
		</MemoryRouter>,
	);
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

async function flush(ms = 3000) {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}
await flush();
await Promise.allSettled(pending);
await flush();

const tabButtons = [...document.querySelectorAll("header button")]
	.map((b) => b.textContent.trim())
	.filter(Boolean);
const hasQueue = tabButtons.includes("Очередь");
const hasBooking = tabButtons.includes("Запись");
console.log(
	"роль:",
	role,
	"| вкладки в шапке:",
	tabButtons.filter((t) => t === "Очередь" || t === "Запись"),
);
if (!hasQueue) {
	console.error("Вкладка «Очередь» не найдена");
	process.exit(1);
}
if (role !== "admin") {
	// Client data stays with administrators only.
	if (hasBooking) {
		console.error("Вкладка «Запись» не должна быть видна этой роли");
		process.exit(1);
	}
	if (process.argv[4] !== "--expect-hidden") {
		console.error("Для проверки скрытия нужен флаг --expect-hidden");
		process.exit(1);
	}
	console.log("OK: вкладка «Запись» скрыта для роли", role);
	process.exit(0);
}
if (!hasBooking) {
	console.error("Вкладка «Запись» не найдена рядом с «Очередь»");
	process.exit(1);
}

// The calendar of the booking tab must render days with counters.
const dayCells = [...document.querySelectorAll("button")].filter((b) =>
	/^\d+/.test(b.textContent.trim()),
);
console.log("дней в календаре:", dayCells.length);
if (dayCells.length === 0) {
	console.error("Календарь не отрисован на вкладке «Запись»");
	process.exit(1);
}

// Switching to the queue tab and back keeps both tabs usable.
const queueTab = [...document.querySelectorAll("header button")].find(
	(b) => b.textContent.trim() === "Очередь",
);
await act(async () => {
	queueTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await flush(500);
const bookingTab = [...document.querySelectorAll("header button")].find(
	(b) => b.textContent.trim() === "Запись",
);
await act(async () => {
	bookingTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await flush(800);
await Promise.allSettled(pending);
await flush(1200);
const afterSwitch = [...document.querySelectorAll("button")].filter((b) =>
	/^\d+/.test(b.textContent.trim()),
).length;
console.log("дней в календаре после переключения вкладок:", afterSwitch);
if (afterSwitch === 0) {
	console.error("Календарь не восстановился после переключения вкладок");
	process.exit(1);
}

// An operator must not see the booking tab: it shows client data.
console.log("OK");
process.exit(0);
