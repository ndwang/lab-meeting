import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build to client/dist (served by the Fastify server). In dev, proxy /api to
// the local server so `npm run dev:client` and `npm run dev:server` compose.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
