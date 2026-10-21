import { defineConfig } from "/home/user/client/node_modules/vitest/dist/config.js";
export default defineConfig({
	resolve: {
		alias: {
			"@testing-library/react":
				"/home/user/client/node_modules/@testing-library/react/dist/index.js",
			react: "/home/user/client/node_modules/react",
			"react-dom": "/home/user/client/node_modules/react-dom",
		},
	},
	test: { environment: "jsdom", include: ["tests/keyboard.test.jsx"] },
});
