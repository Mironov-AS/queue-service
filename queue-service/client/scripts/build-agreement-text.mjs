// Builds a plain text copy of the user agreement page for review and for
// publishing on the sites where the widget is embedded.
//
// Run: node client/scripts/build-agreement-text.mjs
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{ url: "http://127.0.0.1:5175/agreement", pretendToBeVisual: true },
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

const dir = join(process.cwd(), ".agreement-text");
mkdirSync(dir, { recursive: true });
const entry = join(dir, "entry.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import AgreementPage, { AGREEMENT_VERSION, AGREEMENT_UPDATED } from "${process.cwd()}/src/pages/AgreementPage.jsx";
globalThis.__act = act;
globalThis.__version = AGREEMENT_VERSION;
globalThis.__updated = AGREEMENT_UPDATED;
const root = createRoot(document.getElementById("root"));
act(() => {
	root.render(
		<MemoryRouter initialEntries={["/agreement"]}>
			<AgreementPage />
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
await act(async () => {
	await new Promise((r) => setTimeout(r, 500));
});

const container = document.querySelector("main, div");
const article = [...document.querySelectorAll("div")].find((d) =>
	d.querySelector("h1"),
);
const title = article.querySelector("h1").textContent.trim();
const updated = article.querySelector("p").textContent.trim();

const lines = [`# ${title}`, "", `Версия: ${globalThis.__version}`, `Редакция: ${globalThis.__updated}`, ""];
for (const section of article.querySelectorAll("section")) {
	const heading = section.querySelector("h2");
	if (!heading) continue;
	lines.push(`## ${heading.textContent.trim()}`, "");
	for (const p of section.querySelectorAll("p")) {
		lines.push(p.textContent.replace(/\s+/g, " ").trim(), "");
	}
}
const target = join(
	process.cwd(),
	"..",
	"Документация",
	"Пользовательское-соглашение.md",
);
writeFileSync(target, `${lines.join("\n").trim()}\n`, "utf8");
console.log("записан файл:", target);
console.log("символов:", lines.join("\n").length);
process.exit(0);
