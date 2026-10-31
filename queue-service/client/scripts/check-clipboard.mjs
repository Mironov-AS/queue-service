// Check of the clipboard helper: success is reported only when the text was
// really copied, and a failed copy falls back to execCommand.
//
// Run: node client/scripts/check-clipboard.mjs
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(process.cwd(), "client");
const source = readFileSync(join(root, "src/utils/clipboard.js"), "utf8");
const dir = mkdtempSync(join(tmpdir(), "clipboard-check-"));
const outfile = join(dir, "clipboard.mjs");
await build({
	entryPoints: [join(root, "src/utils/clipboard.js")],
	bundle: true,
	format: "esm",
	outfile,
	logLevel: "silent",
});
const { copyText } = await import(`file://${outfile}`);

const failures = [];
const check = (name, condition, extra = "") => {
	if (condition) {
		console.log(`OK   ${name}`);
	} else {
		failures.push(name);
		console.log(`FAIL ${name} ${extra}`);
	}
};

function setNavigator(value) {
	Object.defineProperty(globalThis, "navigator", {
		value,
		configurable: true,
		writable: true,
	});
}

function makeDom() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://example.test/admin",
	});
	return dom;
}

// 1. Clipboard API available and working.
{
	const dom = makeDom();
	let written = null;
	setNavigator({ clipboard: { writeText: async (t) => (written = t) } });
	globalThis.document = dom.window.document;
	const result = await copyText("https://widget.test/booking/abc");
	check("clipboard API: сообщает об успехе", result.ok === true, JSON.stringify(result));
	check("clipboard API: текст передан в буфер", written === "https://widget.test/booking/abc");
	check("clipboard API: метод clipboard", result.method === "clipboard");
}

// 2. Clipboard API rejects (not focused / access denied) -> fallback.
{
	const dom = makeDom();
	let execCalled = 0;
	dom.window.document.execCommand = (cmd) => {
		execCalled += 1;
		return cmd === "copy";
	};
	setNavigator({
		clipboard: {
			writeText: async () => {
				throw new Error("NotAllowedError: Document is not focused.");
			},
		},
	});
	globalThis.document = dom.window.document;
	const result = await copyText("https://widget.test/booking/abc");
	check("отказ API: сработал запасной execCommand", result.method === "execCommand", JSON.stringify(result));
	check("отказ API: сообщает об успехе", result.ok === true);
	check("отказ API: временный textarea удалён", dom.window.document.querySelectorAll("textarea").length === 0);
}

// 3. No Clipboard API at all -> fallback.
{
	const dom = makeDom();
	dom.window.document.execCommand = (cmd) => cmd === "copy";
	setNavigator({});
	globalThis.document = dom.window.document;
	const result = await copyText("https://widget.test/booking/abc");
	check("нет API: сработал запасной путь", result.ok === true, JSON.stringify(result));
	check("нет API: метод execCommand", result.method === "execCommand");
}

// 4. Nothing works -> honest failure.
{
	const dom = makeDom();
	dom.window.document.execCommand = () => false;
	setNavigator({});
	globalThis.document = dom.window.document;
	const result = await copyText("https://widget.test/booking/abc");
	check("полный отказ: сообщает о неудаче", result.ok === false, JSON.stringify(result));
	check("полный отказ: метод none", result.method === "none");
}

// 5. Empty text -> failure without touching the clipboard.
{
	const dom = makeDom();
	setNavigator({ clipboard: { writeText: async () => {} } });
	globalThis.document = dom.window.document;
	const result = await copyText("");
	check("пустая ссылка: сообщает о неудаче", result.ok === false);
}

rmSync(dir, { recursive: true, force: true });
if (failures.length) {
	console.error(`ИТОГ: не пройдено ${failures.length}: ${failures.join(", ")}`);
	process.exit(1);
}
console.log("ИТОГ: все проверки пройдены");
