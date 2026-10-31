// Copying text to the clipboard with an honest result.
//
// navigator.clipboard.writeText() rejects when the document is not focused or
// when the browser blocks clipboard access for the site. The rejection is
// silent unless it is awaited, so the result must be checked before the UI
// claims that the text was copied.
//
// Order: async Clipboard API -> execCommand fallback -> failure with a
// selectable field for manual copying.
export async function copyText(text) {
	const value = typeof text === "string" ? text : "";
	if (!value) return { ok: false, method: "none", error: "empty" };

	try {
		if (
			typeof navigator !== "undefined" &&
			navigator.clipboard &&
			typeof navigator.clipboard.writeText === "function"
		) {
			await navigator.clipboard.writeText(value);
			return { ok: true, method: "clipboard" };
		}
	} catch {
		// Access denied or the document is not focused: try the fallback.
	}

	try {
		if (typeof document === "undefined" || !document.body) {
			return { ok: false, method: "none", error: "no-document" };
		}
		const area = document.createElement("textarea");
		area.value = value;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.top = "-1000px";
		area.style.left = "-1000px";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.focus();
		area.select();
		if (typeof area.setSelectionRange === "function") {
			area.setSelectionRange(0, value.length);
		}
		const copied = document.execCommand("copy");
		document.body.removeChild(area);
		if (copied) return { ok: true, method: "execCommand" };
		return { ok: false, method: "none", error: "exec-command-failed" };
	} catch {
		return { ok: false, method: "none", error: "fallback-failed" };
	}
}
