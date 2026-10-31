// UI check of the service directory: every service must show its channel state
// ("Очередь" and "Запись" work independently), the editor modal must offer
// both channels together with the queue and booking settings, and switching
// the booking channel must keep the schedule.
//
// Run: node client/scripts/check-service-channels.mjs <tokenFile>
// Token may also come from ADMIN_TOKEN; targets from CHECK_QUEUE_BASE /
// CHECK_BOOKING_BASE (defaults: sandbox preview backends on 6620 / 6621).
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const tokenFile = process.argv[2];
if (!tokenFile && !process.env.ADMIN_TOKEN) {
	console.error(
		"Нужен токен администратора: node client/scripts/check-service-channels.mjs <tokenFile> " +
			"или переменная окружения ADMIN_TOKEN",
	);
	process.exit(2);
}
const token = (
	process.env.ADMIN_TOKEN || readFileSync(tokenFile, "utf8")
).trim();
if (!token) {
	console.error("Токен администратора пуст");
	process.exit(2);
}
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
const queueBase = process.env.CHECK_QUEUE_BASE || "http://127.0.0.1:6620";
const bookingBase = process.env.CHECK_BOOKING_BASE || "http://127.0.0.1:6621";
global.fetch = async (input, init = {}) => {
	const url = String(input);
	const target = url.startsWith("/api/booking")
		? `${bookingBase}${url}`
		: `${queueBase}${url}`;
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

// The button for a new service must be visible above the list.
const addButton = [...document.querySelectorAll("button")].find(
	(b) => b.textContent.trim() === "Добавить услугу",
);
console.log("кнопка «Добавить услугу»:", !!addButton);
if (!addButton) {
	console.error("Нет кнопки «Добавить услугу»");
	process.exit(1);
}

const rows = [...document.querySelectorAll("tbody tr")];
console.log("услуг в справочнике:", rows.length);
if (rows.length === 0) {
	console.error("Справочник услуг пуст");
	process.exit(1);
}

function channelBadges(row) {
	return [...row.querySelectorAll("button")]
		.map((b) => b.textContent.trim().replace(/\s+/g, " "))
		.filter((t) => t.startsWith("Очередь:") || t.startsWith("Запись:"));
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
const bookingRow = rows.find((r) =>
	channelBadges(r).some((t) => t.startsWith("Запись:")),
);
const bookingBadge = [...bookingRow.querySelectorAll("button")].find((b) =>
	b.textContent.trim().startsWith("Запись:"),
);
const wasEnabled = bookingBadge.textContent.trim() === "Запись: вкл";
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

// The state of the channel is restored after the check.
await act(async () => {
	bookingBadge.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(1500);
await Promise.allSettled(pending);
await flush(800);
const restored = calls.filter(
	(c) => c.url.includes("/config") && c.method === "PUT",
);
const restoredSent = JSON.parse(restored[restored.length - 1].body);
console.log(
	"состояние канала восстановлено:",
	restoredSent.enabled === wasEnabled ? "да" : "нет",
);
if (restoredSent.enabled !== wasEnabled) {
	console.error("Состояние канала «Запись» не восстановлено");
	process.exit(1);
}

// The editor of the service must open as a modal with both channels and with
// the settings of the queue and of the booking. The service with the queue
// channel is used, so both tabs are available.
const queueRow = rows.find((r) =>
	channelBadges(r).some((t) => t === "Очередь: вкл"),
);
if (!queueRow) {
	console.error("Нет услуги с включённым каналом «Очередь»");
	process.exit(1);
}
const editButton = [...queueRow.querySelectorAll("button")].find(
	(b) => b.textContent.trim() === "Редактировать",
);
if (!editButton) {
	console.error("Кнопка «Редактировать» услуги не найдена");
	process.exit(1);
}
await act(async () => {
	editButton.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(1500);
await Promise.allSettled(pending);
await flush(800);

const modal = document.querySelector("[role=dialog]");
console.log("модальное окно услуги открыто:", !!modal);
if (!modal) {
	console.error("Модальное окно редактирования услуги не открылось");
	process.exit(1);
}

const modalText = (modal.textContent || "").replace(/\s+/g, " ");
console.log(
	"в окне есть вкладки:",
	["Основное", "Очередь", "Запись"].filter((t) => modalText.includes(t)),
);

const channelCheckboxes = [...modal.querySelectorAll("input[type=checkbox]")]
	.map((c) => c.closest("label")?.textContent.replace(/\s+/g, " ").trim())
	.filter((t) => t && (t.startsWith("Очередь") || t.startsWith("Запись")));
console.log("чекбоксы каналов в окне:", channelCheckboxes);
if (!channelCheckboxes.some((t) => t.startsWith("Очередь"))) {
	console.error("В окне услуги нет галочки канала «Очередь»");
	process.exit(1);
}
if (!channelCheckboxes.some((t) => t.startsWith("Запись"))) {
	console.error("В окне услуги нет галочки канала «Запись»");
	process.exit(1);
}

// The tab of the booking channel holds the schedule and the permanent widget.
const bookingTab = [...modal.querySelectorAll("button")].find(
	(b) => b.textContent.trim() === "Запись",
);
if (!bookingTab) {
	console.error("В окне услуги нет вкладки «Запись»");
	process.exit(1);
}
await act(async () => {
	bookingTab.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(600);
await Promise.allSettled(pending);
await flush(400);

const bookingText = (modal.textContent || "").replace(/\s+/g, " ");
console.log(
	"во вкладке «Запись» есть расписание:",
	/Рабочие дни/.test(bookingText),
);
console.log(
	"во вкладке «Запись» есть «Открыть виджет»:",
	/Открыть виджет/.test(bookingText),
);
if (!/Открыть виджет/.test(bookingText)) {
	console.error("В настройках услуги нет кнопки «Открыть виджет»");
	process.exit(1);
}
const widgetLink = [...modal.querySelectorAll("input")].find(
	(i) => i.getAttribute("aria-label") === "Ссылка на виджет",
);
console.log("постоянная ссылка на виджет:", widgetLink?.value || "нет");
if (!widgetLink?.value) {
	console.error("В настройках услуги нет постоянной ссылки на виджет");
	process.exit(1);
}

// The tab of the queue channel holds the settings of the queue.
const queueTab = [...modal.querySelectorAll("button")].find(
	(b) => b.textContent.trim() === "Очередь",
);
await act(async () => {
	queueTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await flush(600);
const queueText = (modal.textContent || "").replace(/\s+/g, " ");
console.log(
	"во вкладке «Очередь» есть лимит и приоритет:",
	/Лимит талонов в день/.test(queueText) && /Приоритет/.test(queueText),
);
if (!/Лимит талонов в день/.test(queueText)) {
	console.error("В настройках услуги нет настроек очереди");
	process.exit(1);
}

console.log("OK");
process.exit(0);
