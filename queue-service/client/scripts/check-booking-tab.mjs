// Component-level check of the admin booking tab against the running preview
// API: the calendar must show days with bookings and the day panel must show
// the client data entered by the customer.
//
// Run: node client/scripts/check-booking-tab.mjs <adminToken>
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import { readFileSync } from "node:fs";
const tokenFile = process.argv[2];
if (!tokenFile) {
	console.error("Нужен путь к файлу с токеном администратора");
	process.exit(1);
}
const token = readFileSync(tokenFile, "utf8").trim();

const nativeFetch = globalThis.fetch;
const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{
		url: "http://127.0.0.1:5175/admin",
		pretendToBeVisual: true,
	},
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
global.fetch = async (input, init = {}) => {
	const url = String(input);
	const target = url.startsWith("/api/booking")
		? `http://127.0.0.1:6621${url}`
		: `http://127.0.0.1:6620${url}`;
	console.log("fetch ->", target);
	const res = await nativeFetch(target, {
		...init,
		headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
	});
	console.log("fetch", target, res.status);
	return res;
};

const dir = join(process.cwd(), ".booking-tab-check");
mkdirSync(dir, { recursive: true });
const entry = join(dir, "entry.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BookingTab from "${process.cwd()}/src/components/admin/BookingTab.jsx";
globalThis.__act = act;
const root = createRoot(document.getElementById("root"));
act(() => { root.render(<BookingTab />); });
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
	define: { "process.env.NODE_ENV": '"development"' },
	external: ["jsdom"],
});
require(out);
const act = globalThis.__act;

const pending = [];
const realFetch = global.fetch;
global.fetch = (...args) => {
	const p = realFetch(...args);
	pending.push(p.catch(() => {}));
	return p;
};

async function flush() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 4000));
	});
}
await flush();
await Promise.allSettled(pending);
await flush();

console.log("--- body ---");
console.log(
	(document.body.textContent || "").replace(/\s+/g, " ").slice(0, 600),
);
console.log("select value:", document.querySelector("select")?.value);
console.log("--- / ---");
// Move to the next month: the preview data lives in November 2026.
const next = [...document.querySelectorAll("button")].find(
	(b) => b.getAttribute("aria-label") === "Следующий месяц",
);
await act(async () => {
	next.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await flush();
await Promise.allSettled(pending);
await flush();

const dayCells = [...document.querySelectorAll("button")].filter((b) =>
	/^\d+/.test(b.textContent.trim()),
);
const bookedDay = dayCells.find((b) => /записей:/.test(b.textContent));
console.log("дней в календаре:", dayCells.length);
console.log(
	"пример дня с записями:",
	bookedDay ? bookedDay.textContent.trim() : "нет",
);

if (!bookedDay) {
	console.error("День с записями не найден");
	process.exit(1);
}
await act(async () => {
	bookedDay.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush();
const panel = document.body.textContent || "";
const hasClientData = /Номер авто/.test(panel) && /Телефон/.test(panel);
console.log("в панели дня есть поля клиента:", hasClientData);
// The month list must show every booking of the month with client data.
const table = document.querySelector("table");
const rows = table ? [...table.querySelectorAll("tbody tr")] : [];
console.log("строк в списке записей за месяц:", rows.length);
const withClientData = rows.filter(
	(r) => /Номер авто/.test(r.textContent) && /Телефон/.test(r.textContent),
).length;
const withTime = rows.every((r) => /\d{2}:\d{2}/.test(r.textContent));
const monthListOk = rows.length > 0 && withClientData > 0 && withTime;
console.log(
	"строк с данными клиента:",
	withClientData,
	"из",
	rows.length,
	"| у всех есть время:",
	withTime,
);
if (!monthListOk) {
	console.error("Список записей за месяц не заполнен данными клиентов");
	process.exit(1);
}
const start = panel.indexOf("занято");
console.log(
	"фрагмент панели:",
	panel.replace(/\s+/g, " ").slice(start, start + 260),
);
if (!hasClientData) {
	console.error("Данные клиентов в панели дня не показаны");
	process.exit(1);
}
// Cancellation from the day panel: the booking must disappear from the day.
dom.window.confirm = () => true;
const cancelButton = [...document.querySelectorAll("button")].find(
	(b) => b.textContent.trim() === "Отменить",
);
if (!cancelButton) {
	console.error("Кнопка отмены не найдена");
	process.exit(1);
}
const before = (document.body.textContent.match(/Номер авто/g) || []).length;
await act(async () => {
	cancelButton.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush();
await Promise.allSettled(pending);
await flush();
const after = (document.body.textContent.match(/Номер авто/g) || []).length;
console.log("записей с данными до отмены:", before, "после:", after);
if (after >= before) {
	console.error("Запись не исчезла после отмены");
	process.exit(1);
}

// Restore the preview data so the demo keeps showing booked clients.
const publicId = "abfbf676-98f5-4dda-960d-57bc4ceaf1bd";
const restore = await nativeFetch(
	`http://127.0.0.1:6621/api/booking/public/${publicId}`,
	{
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			date: "2026-11-03",
			start: "09:00",
			answers: { car: "А777ВС77", phone: "+79991111111" },
			consent: true,
			consentVersion: "preview-2026-10-30",
		}),
	},
);
console.log("восстановление записи:", restore.status);

console.log("OK");
process.exit(0);
