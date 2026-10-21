import config from '../vite.config.js';
// Local-only entry: use the real keyboard, never connect to production.
export default {
  ...config,
  plugins: [...config.plugins, {
    name: 'isolated-keyboard-preview',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url === '/terminal') req.url = '/keyboard-preview.html';
        next();
      });
    },
  }],
  server: { host: '0.0.0.0', allowedHosts: true },
};
