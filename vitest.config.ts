import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      AUTH_JWT_SECRET: 'test-secret-must-be-at-least-32-characters-long!!',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
      IG_APP_ID: '1234567890',
      IG_APP_SECRET: 'test-app-secret',
      IG_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
      LOG_LEVEL: 'error',
    },
  },
  resolve: {
    alias: { '~': resolve(__dirname, './src') },
  },
});
