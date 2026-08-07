import { useState, useEffect, useRef, useCallback } from "react";

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
	onFieldFocus,
	onSubmit,
	hasFields = false,
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
		<div className="fixed inset-x-0 bottom-0 bg-gray-800/95 backdrop-blur-sm border-t-2 border-green-600 z-50 safe-area-bottom">
			{/* Active field indicator */}
			<div
				className="flex items-center justify-center py-2 bg-gray-900/50 cursor-pointer"
				onClick={() => setShowKeyboard(false)}
			>
				<span className="text-green-400 text-sm">Клавиатура</span>
				<span className="text-white/40 text-xs ml-2">
					(нажмите чтобы скрыть)
				</span>
			</div>

			{/* Keyboard */}
			<div className="max-w-4xl mx-auto px-2 py-3">
				{KEYBOARD_ROWS.map((row, rowIdx) => (
					<div key={rowIdx} className="flex justify-center gap-1.5 my-1.5">
						{row.map((key, keyIdx) => (
							<button
								key={`${rowIdx}-${keyIdx}`}
								type="button"
								onClick={() => handleKey(key)}
								className="min-w-[36px] h-12 px-2 sm:min-w-[44px] sm:h-14 sm:px-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-xl sm:text-2xl font-medium transition-colors shadow-lg select-none"
							>
								{key}
							</button>
						))}
					</div>
				))}

				{/* Bottom row with special keys */}
				<div className="flex justify-center gap-1.5 mt-1.5">
					{/* Backspace */}
					<button
						type="button"
						onClick={() => handleKey("back")}
						className="h-14 px-4 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-2xl transition-colors shadow-lg select-none"
					>
						⌫
					</button>

					{/* Space */}
					<button
						type="button"
						onClick={() => handleKey("space")}
						className="flex-1 h-14 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl flex items-center justify-center text-white text-xl transition-colors shadow-lg select-none"
					>
						пробел
					</button>

					{/* Enter / Submit */}
					{onSubmit && (
						<button
							type="button"
							onClick={() => handleKey("enter")}
							className="h-14 px-6 bg-green-600 hover:bg-green-500 active:bg-green-400 rounded-xl flex items-center justify-center text-white text-xl font-bold transition-colors shadow-lg select-none"
						>
							✓
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
