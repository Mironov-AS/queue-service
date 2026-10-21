import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TouchKeyboard from "../src/components/TouchKeyboard";

afterEach(cleanup);
const props = {
	fieldValues: { name: "аб" },
	activeFieldId: "name",
	hasFields: true,
	noFixed: true,
};
describe("TouchKeyboard", () => {
	it("reduces character key width by 40 percent without reducing height", () => {
		render(<TouchKeyboard {...props} onFieldChange={vi.fn()} />);
		const key = screen.getByRole("button", { name: "й" });
		expect(key.style.width).toContain("67.2px");
		expect(key.className).toContain("h-14");
		expect(key.className).toContain("shrink-0");
		expect(key.style.maxWidth).toBe("");
		expect(key.closest(".overflow-x-auto")).toBeTruthy();
	});
	it("preserves typing, deletion, space, layout toggle and submit", () => {
		const change = vi.fn(),
			submit = vi.fn();
		render(
			<TouchKeyboard {...props} onFieldChange={change} onSubmit={submit} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "й" }));
		expect(change).toHaveBeenLastCalledWith("name", "абй");
		fireEvent.click(screen.getByRole("button", { name: "⌫" }));
		expect(change).toHaveBeenLastCalledWith("name", "а");
		fireEvent.click(screen.getByRole("button", { name: "пробел" }));
		expect(change).toHaveBeenLastCalledWith("name", "аб ");
		fireEvent.click(screen.getByRole("button", { name: "EN" }));
		fireEvent.click(screen.getByRole("button", { name: "q" }));
		expect(change).toHaveBeenLastCalledWith("name", "абq");
		fireEvent.click(screen.getByRole("button", { name: "RU" }));
		expect(screen.getByRole("button", { name: "й" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "✓" }));
		expect(submit).toHaveBeenCalledTimes(1);
	});
	it("does not render without fields", () => {
		const { container } = render(
			<TouchKeyboard {...props} hasFields={false} />,
		);
		expect(container.innerHTML).toBe("");
	});
});
