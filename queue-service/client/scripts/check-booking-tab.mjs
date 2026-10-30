// Component-level check of the admin booking tab against the running preview
// API: the day panel must show the slots of the current day by default, the
// calendar opens from the date button next to the service list, and the client
// data of the bookings must be shown.
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
	const res = await nativeFetch(target, {
		...init,
		headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
	});
	console.log("fetch", target, res.status);
	return res;
};

const probeRes = await nativeFetch(
	"http://127.0.0.1:6621/api/booking/services/2/month?month=2026-10",
	{ headers: { authorization: `Bearer ${token}` } },
);
console.log("probe", probeRes.status, (await probeRes.text()).length);

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

async function flush(ms = 800) {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
	await Promise.allSettled(pending);
	// The response body arrives on the socket later, so the event loop must
	// run outside act() before React applies the updates.
	await new Promise((r) => setTimeout(r, 200));
	await act(async () => {
		await new Promise((r) => setTimeout(r, 200));
	});
	await Promise.allSettled(pending);
}
await flush(2500);

const probe2 = await nativeFetch(
	"http://127.0.0.1:6621/api/booking/services/2/month?month=2026-10",
	{ headers: { authorization: `Bearer ${token}` } },
);
console.log("probe2 status", probe2.status);
const probe2Text = await Promise.race([
	probe2.text().then((t) => `len ${t.length}`),
	new Promise((r) => setTimeout(() => r("TIMEOUT"), 5000)),
]);
console.log("probe2 body", probe2Text);

const body = () => (document.body.textContent || "").replace(/\s+/g, " ");

// The settings of the booking and the widget link must not live in the tab.
console.log("--- вкладка записи ---");
console.log(body().slice(0, 400));
if (/Настройки записи/.test(body())) {
	console.error("Кнопка «Настройки записи» осталась во вкладке «Запись»");
	process.exit(1);
}
if (/Открыть виджет/.test(body())) {
	console.error("Кнопка «Открыть виджет» осталась во вкладке «Запись»");
	process.exit(1);
}

const serviceSelect = document.querySelector("select");
const serviceOptions = [...serviceSelect.options].map((o) => ({
	value: o.value,
	label: o.textContent.trim(),
}));
console.log("услуги в списке:", serviceOptions.map((o) => o.label).join(", "));

// The preview data lives in one service, so the check works with the service
// that actually has bookings.
let chosen = serviceOptions[0];
for (const option of serviceOptions) {
	const res = await nativeFetch(
		`http://127.0.0.1:6621/api/booking/services/${option.value}/bookings?month=2026-11`,
		{ headers: { authorization: `Bearer ${token}` } },
	);
	const body = await res.json();
	if (body.bookings && body.bookings.length) {
		chosen = option;
		break;
	}
}
console.log("проверяем услугу:", chosen.label);
if (chosen.value !== serviceSelect.value) {
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLSelectElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(serviceSelect, chosen.value);
		serviceSelect.dispatchEvent(
			new dom.window.Event("change", { bubbles: true }),
		);
	});
	await flush(1500);
}

// The slot of the current day must be open by default.
const slotsToday = [...document.querySelectorAll("div")].filter((d) =>
	/^\d{2}:\d{2}–\d{2}:\d{2}\s*занято \d+ из \d+/.test(d.textContent.trim()),
);
console.log("слотов текущего дня по умолчанию:", slotsToday.length);
if (slotsToday.length === 0) {
	console.error("Слоты текущего дня не показаны по умолчанию");
	process.exit(1);
}

// The calendar opens from the button next to the service list.
const dateButton = [...document.querySelectorAll("button")].find(
	(b) =>
		b.parentElement?.tagName !== "SELECT" &&
		/сегодня|выбрать дату/i.test(b.textContent),
);
if (!dateButton) {
	console.error("Кнопка выбора даты рядом со списком услуг не найдена");
	process.exit(1);
}
console.log("кнопка даты:", dateButton.textContent.trim());
await act(async () => {
	dateButton.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(1500);
const dialog = document.querySelector("[role=dialog]");
if (!dialog) {
	console.error("Календарь не открылся");
	process.exit(1);
}
console.log("календарь открыт:", dialog.textContent.trim().slice(0, 80));

// The preview bookings live in another month, so the calendar is paged
// forward until a day with bookings shows up.
let dayCells = [];
let bookedDay = null;
for (let i = 0; i < 3 && !bookedDay; i++) {
	dayCells = [...dialog.querySelectorAll("button")].filter((b) =>
		/^\d+/.test(b.textContent.trim()),
	);
	bookedDay = dayCells.find((b) => /записей:/.test(b.textContent));
	if (bookedDay) break;
	const nextMonth = [...dialog.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === "Следующий месяц",
	);
	if (!nextMonth) break;
	await act(async () => {
		nextMonth.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true }),
		);
	});
	await flush(1500);
}
console.log("дней в календаре:", dayCells.length);
console.log(
	"пример дня с записями:",
	bookedDay ? bookedDay.textContent.trim() : "нет",
);
if (!bookedDay) {
	console.error("День с записями не найден в календаре");
	process.exit(1);
}
await act(async () => {
	bookedDay.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(1500);
if (document.querySelector("[role=dialog]")) {
	console.error("Календарь не закрылся после выбора даты");
	process.exit(1);
}

const hasClientData = /Номер авто/.test(body()) && /Телефон/.test(body());
console.log("в панели дня есть поля клиента:", hasClientData);
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
const before = (body().match(/Номер авто/g) || []).length;
await act(async () => {
	cancelButton.dispatchEvent(
		new dom.window.MouseEvent("click", { bubbles: true }),
	);
});
await flush(2000);
const after = (body().match(/Номер авто/g) || []).length;
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
			consentVersion: "agreement-2026-10-30-v1",
		}),
	},
);
console.log("восстановление записи:", restore.status);

console.log("OK");
process.exit(0);
