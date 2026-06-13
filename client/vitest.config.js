import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest runs the client's component + hook tests in a jsdom environment,
// with no browser and no running server. globals: true enables describe/it/expect
// without imports; setupFiles registers the jest-dom matchers.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
  },
});
