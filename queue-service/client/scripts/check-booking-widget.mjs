// UI check of the public booking widget: the visitor has to confirm the user
// agreement with a checkbox before the booking can be sent, and the request
// must carry the version of the accepted agreement.
//
// Run: node client/scripts/check-booking-widget.mjs
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publicId = process.argv[2];
if (!publicId) {
	console.error("Нужен публичный идентификатор виджета");
	process.exit(1);
}
const nativeFetch = globalThis.fetch;

const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{
		url: `http://127.0.0.1:5175/booking/${publicId}?date=2026-11-03`,
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

const sent = [];
global.fetch = async (input, init = {}) => {
	const url = String(input);
	const target = url.startsWith("/api/booking")
		? `http://127.0.0.1:6621${url}`
		: `http://127.0.0.1:5175${url}`;
	console.log("-> ", target, init.method || "GET");
	if (init.method === "POST") {
		sent.push({ url, body: JSON.parse(init.body || "{}") });
	}
	const res = await nativeFetch(target, init);
	console.log("fetch", target, res.status);
	return res;
};

const dir = join(process.cwd(), ".widget-check");
mkdirSync(dir, { recursive: true });
const entry = join(dir, "entry.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BookingPage from "${process.cwd()}/src/pages/BookingPage.jsx";
globalThis.__act = act;
const root = createRoot(document.getElementById("root"));
act(() => {
	root.render(
		<MemoryRouter initialEntries={["/booking/${publicId}?date=2026-11-03"]}>
			<Routes>
				<Route path="/booking/:publicId" element={<BookingPage />} />
			</Routes>
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

async function flush(ms = 1500) {
	await act(async () => {
		await new Promise((r) => setTimeout(r, ms));
	});
}
await flush(2500);

// The form with the agreement checkbox appears after a slot is chosen.
const slotButtons = [...document.querySelectorAll("button")].filter((b) =>
	/^\d{2}:\d{2}/.test(b.textContent.trim()),
);
console.log("слотов на выбранный день:", slotButtons.length);
console.log(
	"ТЕЛО:",
	(document.body.textContent || "").replace(/\s+/g, " ").slice(0, 500),
);
if (slotButtons.length === 0) {
	console.error("Слоты не показаны");
	process.exit(1);
}
const freeSlot = slotButtons.find((b) => !b.disabled) || slotButtons[0];
await act(async () => {
	freeSlot.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
await flush(800);

const text = document.body.textContent || "";
const logo = document.querySelector('img[alt="Максима"]');
console.log("логотип в виджете:", logo ? logo.getAttribute("src") : "нет");
if (!logo || !/logo\.png$/.test(logo.getAttribute("src") || "")) {
	console.error("В виджете нет логотипа Максима");
	process.exit(1);
}
const checkboxes = [...document.querySelectorAll("input[type=checkbox]")];
const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Записаться");
if (checkboxes.length !== 2 || !button?.disabled) throw new Error("Нужны две отметки, кнопка должна быть заблокирована");
if (!/Пользовательск/.test(text)) throw new Error("Нет ссылки на соглашение");
await act(async () => checkboxes[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
await flush(300);
if (!button.disabled) throw new Error("Одна отметка не должна разрешать запись");
await act(async () => checkboxes[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
await flush(300);
if (button.disabled) throw new Error("Обе отметки должны разрешать запись");

// Fill the required fields and send the booking.
for (const input of document.querySelectorAll(
	"input[type=text], input[type=tel]",
)) {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLInputElement.prototype,
			"value",
		).set;
		setter.call(input, "А001АА77");
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
}
await flush(400);
const form = document.querySelector("form");
await act(async () => {
	form.dispatchEvent(
		new dom.window.Event("submit", { bubbles: true, cancelable: true }),
	);
});
await flush(2500);

console.log("запросов создания записи:", sent.length);
if (sent.length === 0) {
	console.error("Запись не была отправлена");
	process.exit(1);
}
const body = sent[sent.length - 1].body;
console.log("в запросе:", JSON.stringify(body));
if (body.consent !== true || body.agreement !== true) {
	console.error("В запросе нет подтверждения согласия");
	process.exit(1);
}
if (!body.consentVersion) {
	console.error("В запросе нет версии согласия");
	process.exit(1);
}
console.log("OK");
process.exit(0);
