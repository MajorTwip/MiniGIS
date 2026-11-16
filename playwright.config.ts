import { defineConfig } from '@playwright/test';

// Runs against an already running instance (docker compose ... up -d).
// Browsers come from PLAYWRIGHT_BROWSERS_PATH; no `playwright install` is needed where Chromium is preinstalled.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.MINIGIS_URL ?? 'http://localhost:8080',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
});
