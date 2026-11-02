import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (response.headersSent) return;
            response.writeHead(503, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
              error: 'Pharmacy API is unavailable. Start it with `npm run server` and check your MongoDB configuration.',
            }));
          });
        },
      },
    },
  },
});
