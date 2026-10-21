import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TouchKeyboard from "../src/components/TouchKeyboard";
import "../src/index.css";

function KeyboardPreview() {
	const [value, setValue] = useState("");
	const [submitted, setSubmitted] = useState(false);
	return (
		<main className="min-h-screen flex flex-col">
			<section className="max-w-3xl w-full mx-auto p-6 flex-1">
				<h1 className="text-2xl font-bold mb-4">
					Проверка виртуальной клавиатуры
				</h1>
				<p className="mb-5 text-gray-600">
					Широкие клавиши 67,2 × 56 px. Это изолированное превью: реальные талоны не
					создаются.
				</p>
				<label className="block mb-2" htmlFor="preview-input">
					Тестовое поле
				</label>
				<input
					id="preview-input"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					className="w-full border-2 rounded-xl p-4 text-2xl"
				/>
				{submitted && (
					<p role="status" className="mt-4 text-green-700">
						Кнопка подтверждения нажата. Данные никуда не отправлены.
					</p>
				)}
			</section>
			<TouchKeyboard
				fieldValues={{ preview: value }}
				activeFieldId="preview"
				onFieldChange={(_, text) => {
					setValue(text);
					setSubmitted(false);
				}}
				onSubmit={() => setSubmitted(true)}
				hasFields
				noFixed
			/>
		</main>
	);
}

createRoot(document.getElementById("root")).render(<KeyboardPreview />);
