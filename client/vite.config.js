import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/queue/",
	plugins: [react()],
	server: {
		host: "0.0.0.0",
		port: 3002,
		allowedHosts: true,
		proxy: {
			"/api": {
				target: "http://localhost:3001",
				changeOrigin: true,
			},
			"/uploads": {
				target: "http://localhost:3001",
				changeOrigin: true,
			},
			"/socket.io": {
				target: "http://localhost:3001",
				ws: true,
				changeOrigin: true,
			},
		},
	},
});
