// Builds plain-text copies of the /privacy and /consent pages for review and
// for publishing next to the queue screens.
//
// Run: node client/scripts/build-legal-pages-text.mjs
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const dom = new JSDOM(
	"<!doctype html><html><body><div id='root'></div></body></html>",
	{ url: "http://127.0.0.1:5175/privacy", pretendToBeVisual: true },
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
const entry = join(dir, "entry-legal.jsx");
writeFileSync(
	entry,
	`import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PrivacyPolicyPage, ConsentPage } from "${process.cwd()}/src/pages/LegalPages.jsx";
globalThis.__act = act;
globalThis.__createRoot = createRoot;
globalThis.__MemoryRouter = MemoryRouter;
globalThis.__React = React;
globalThis.__PrivacyPolicyPage = PrivacyPolicyPage;
globalThis.__ConsentPage = ConsentPage;
const root = createRoot(document.getElementById("root"));
act(() => {
	root.render(
		<MemoryRouter initialEntries={["/privacy"]}>
			<PrivacyPolicyPage />
		</MemoryRouter>,
	);
});
`,
);
const out = join(dir, "bundle-legal.js");
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
const createRoot = globalThis.__createRoot;
const MemoryRouter = globalThis.__MemoryRouter;
const { createElement } = globalThis.__React;
await act(async () => {
	await new Promise((r) => setTimeout(r, 500));
});

function extract() {
	const article = [...document.querySelectorAll("div")].find((d) =>
		d.querySelector("h1"),
	);
	const title = article.querySelector("h1").textContent.trim();
	const updated = article.querySelector("p").textContent.trim();
	const lines = [`# ${title}`, "", updated, ""];
	// Lead paragraphs before the first section (not inside any section).
	const lead = [...article.querySelectorAll("p")]
		.filter((p) => !p.closest("section"))
		.map((p) => p.textContent.replace(/\s+/g, " ").trim())
		.filter((text) => text && text !== updated);
	for (const text of lead) lines.push(text, "");
	for (const section of article.querySelectorAll("section")) {
		const heading = section.querySelector("h2");
		if (!heading) continue;
		lines.push(`## ${heading.textContent.trim()}`, "");
		for (const p of section.querySelectorAll("p")) {
			lines.push(p.textContent.replace(/\s+/g, " ").trim(), "");
		}
	}
	return lines.join("\n").trim() + "\n";
}

const container = document.getElementById("root");
let currentRoot = null;

async function renderAndExtract(Page) {
	if (currentRoot) {
		await act(async () => currentRoot.unmount());
		currentRoot = null;
	}
	await act(async () => {
		currentRoot = createRoot(container);
		currentRoot.render(
			createElement(
				MemoryRouter,
				{ initialEntries: ["/privacy"] },
				createElement(Page),
			),
		);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 300));
	});
	return extract();
}

const targets = [
	[globalThis.__PrivacyPolicyPage, "Политика-очередь.md"],
	[globalThis.__ConsentPage, "Согласие-очередь.md"],
];

for (const [Page, file] of targets) {
	const text = await renderAndExtract(Page);
	const target = join(process.cwd(), "..", "Документация", file);
	writeFileSync(target, text, "utf8");
	console.log("записан файл:", target);
}

process.exit(0);
