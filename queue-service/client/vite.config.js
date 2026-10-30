import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		port: 3000,
		allowedHosts: true,
		proxy: {
			// Sandbox preview: the booking module runs as a separate process on an
			// isolated local PostgreSQL; the queue itself stays on SQLite.
			"/api/booking": {
				target: "http://localhost:6621",
				changeOrigin: true,
			},
			"/api": {
				target: "http://localhost:6620",
				changeOrigin: true,
			},
			"/uploads": {
				target: "http://localhost:6620",
				changeOrigin: true,
			},
			"/socket.io": {
				target: "http://localhost:6620",
				ws: true,
				changeOrigin: true,
			},
		},
	},
});
