import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		port: 3000,
		allowedHosts: true,
		proxy: {
			// Sandbox preview intentionally targets SQLite port 6620. The future
			// PostgreSQL runtime remains unimplemented, so this is not a PostgreSQL check.
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
