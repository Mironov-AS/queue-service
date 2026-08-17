import { useState, useEffect, useCallback } from "react";

// ─── Touch Keyboard Component ───────────────────────────────────────────────────
// Unified keyboard: Russian letters + numbers on same layout
// Shows automatically when there are fields to fill

const KEYBOARD_ROWS = [
	["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
	["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х"],
	["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э"],
	["ё", "я", "ч", "с", "м", "и", "т", "ь", "б", "ю"],
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

	if (!showKeyboard || !hasFields) return null;

	return (
		<div
			className={`bg-gray-800 border-t-2 border-green-500 safe-area-bottom ${noFixed ? "" : "fixed inset-x-0 bottom-0 z-50"}`}
		>
			{/* Active field indicator */}
			<div
				className="flex items-center justify-center py-2 bg-gray-900 cursor-pointer"
				onClick={() => setShowKeyboard(false)}
			>
				<span className="text-green-400 text-sm sm:text-base font-medium">
					Клавиатура
				</span>
				<span className="text-white/50 text-xs sm:text-sm ml-3">
					(нажмите чтобы скрыть)
				</span>
			</div>

			{/* Keyboard — full width, extra large for touch */}
			<div className="w-full px-2 py-3">
				{KEYBOARD_ROWS.map((row, rowIdx) => (
					<div key={rowIdx} className="flex justify-center gap-2 my-1.5">
						{row.map((key, keyIdx) => (
							<button
								key={`${rowIdx}-${keyIdx}`}
								type="button"
								onClick={() => handleKey(key)}
								className="min-w-[48px] h-16 px-2 text-xl bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white font-bold transition-colors select-none touch-manipulation"
							>
								{key}
							</button>
						))}
					</div>
				))}

				{/* Bottom row with special keys */}
				<div className="flex justify-center gap-3 mt-2">
					{/* Backspace */}
					<button
						type="button"
						onClick={() => handleKey("back")}
						className="h-16 px-6 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-2xl transition-colors select-none touch-manipulation"
					>
						⌫
					</button>

					{/* Space */}
					<button
						type="button"
						onClick={() => handleKey("space")}
						className="flex-1 h-16 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-lg transition-colors select-none touch-manipulation"
					>
						пробел
					</button>

					{/* Enter / Submit */}
					{onSubmit && (
						<button
							type="button"
							onClick={() => handleKey("enter")}
							className="h-16 px-8 bg-green-600 hover:bg-green-500 active:bg-green-400 rounded-xl flex items-center justify-center text-white text-2xl font-bold transition-colors select-none touch-manipulation"
						>
							✓
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
