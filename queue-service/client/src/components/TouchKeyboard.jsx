import { useState, useEffect, useCallback } from "react";

// ─── Touch Keyboard Component ───────────────────────────────────────────────────
// Unified keyboard: Russian + English letters + numbers
// Shows automatically when there are fields to fill

const RU_KEYBOARD_ROWS = [
	["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
	["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х"],
	["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э"],
	["ё", "я", "ч", "с", "м", "и", "т", "ь", "б", "ю"],
];

const EN_KEYBOARD_ROWS = [
	["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
	["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
	["a", "s", "d", "f", "g", "h", "j", "k", "l"],
	["z", "x", "c", "v", "b", "n", "m"],
];

export default function TouchKeyboard({
	fieldValues,
	onFieldChange,
	activeFieldId,
	onSubmit,
	hasFields = false,
	noFixed = false,
}) {
	const [showKeyboard, setShowKeyboard] = useState(false);
	const [lang, setLang] = useState("ru"); // 'ru' or 'en'

	// Show keyboard automatically when there are fields to fill
	useEffect(() => {
		if (hasFields) {
			setShowKeyboard(true);
		}
	}, [hasFields]);

	const handleKey = useCallback(
		(key) => {
			if (key === "back") {
				const current = fieldValues[activeFieldId] || "";
				onFieldChange(activeFieldId, current.slice(0, -1));
			} else if (key === "space") {
				const current = fieldValues[activeFieldId] || "";
				onFieldChange(activeFieldId, current + " ");
			} else if (key === "enter") {
				if (onSubmit) onSubmit();
			} else {
				const current = fieldValues[activeFieldId] || "";
				if (current.length < 100) {
					onFieldChange(activeFieldId, current + key);
				}
			}
		},
		[fieldValues, activeFieldId, onFieldChange, onSubmit],
	);

	const currentRows = lang === "ru" ? RU_KEYBOARD_ROWS : EN_KEYBOARD_ROWS;

	if (!showKeyboard || !hasFields) return null;

	return (
		<div
			className={`bg-gray-800 border-t-2 border-green-500 safe-area-bottom ${noFixed ? "" : "fixed inset-x-0 bottom-0 z-50"}`}
		>
			{/* Header with language toggle */}
			<div className="flex items-center justify-between px-3 py-2 bg-gray-900">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setLang(lang === "ru" ? "en" : "ru")}
						className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
							lang === "ru"
								? "bg-blue-600 text-white"
								: "bg-gray-700 text-gray-300 hover:bg-gray-600"
						}`}
					>
						RU
					</button>
					<button
						type="button"
						onClick={() => setLang(lang === "en" ? "ru" : "en")}
						className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
							lang === "en"
								? "bg-blue-600 text-white"
								: "bg-gray-700 text-gray-300 hover:bg-gray-600"
						}`}
					>
						EN
					</button>
				</div>
				<button
					type="button"
					className="text-white/50 hover:text-white text-xs transition-colors"
					onClick={() => setShowKeyboard(false)}
				>
					✕ скрыть
				</button>
			</div>

			{/* Keyboard rows */}
			<div className="max-w-3xl mx-auto px-2 py-3">
				{currentRows.map((row, rowIdx) => (
					<div key={rowIdx} className="flex justify-center gap-1.5 my-1">
						{row.map((key, keyIdx) => (
							<button
								key={`${rowIdx}-${keyIdx}`}
								type="button"
								onClick={() => handleKey(key)}
								className="min-w-[36px] h-14 px-1 text-lg bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white font-medium transition-colors select-none touch-manipulation"
							>
								{key}
							</button>
						))}
					</div>
				))}

				{/* Bottom row with special keys */}
				<div className="flex justify-center gap-2 mt-1">
					{/* Backspace */}
					<button
						type="button"
						onClick={() => handleKey("back")}
						className="h-14 px-5 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-xl transition-colors select-none touch-manipulation"
					>
						⌫
					</button>

					{/* Space */}
					<button
						type="button"
						onClick={() => handleKey("space")}
						className="flex-1 h-14 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-base transition-colors select-none touch-manipulation"
					>
						{lang === "ru" ? "пробел" : "space"}
					</button>

					{/* Enter / Submit */}
					{onSubmit && (
						<button
							type="button"
							onClick={() => handleKey("enter")}
							className="h-14 px-6 bg-green-600 hover:bg-green-500 active:bg-green-400 rounded-xl flex items-center justify-center text-white text-xl font-bold transition-colors select-none touch-manipulation"
						>
							✓
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
