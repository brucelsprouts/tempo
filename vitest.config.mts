import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // `scripts` too: the backup script's retention rules decide which files get
    // deleted, which is not logic to leave untested just because it lives
    // outside the app.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
