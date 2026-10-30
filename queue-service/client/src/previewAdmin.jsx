import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminPage from "./pages/AdminPage.jsx";

localStorage.setItem("adminToken", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc5MzM2Mjk5NSwiZXhwIjoxNzkzNDQ5Mzk1fQ.KuVK1-yjC3hRj-IKFj0Cx4ySgZvJRfHhFs9eTMfdovc");
localStorage.setItem(
	"adminUser",
	JSON.stringify({ id: 1, username: "admin", role: "admin" }),
);

createRoot(document.getElementById("root")).render(
	<MemoryRouter initialEntries={["/admin?tab=booking"]}>
		<Routes>
			<Route path="/admin" element={<AdminPage />} />
		</Routes>
	</MemoryRouter>,
);
