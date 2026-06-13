import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Client test runner. jsdom gives the React components a DOM; globals lets the
// test files use describe/it/expect without imports.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
