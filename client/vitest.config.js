import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test config for the client. Uses jsdom so React hooks render headlessly via
// @testing-library/react's renderHook. Kept separate from vite.config.js so the
// build pipeline stays untouched.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
