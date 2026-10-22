import { defineConfig } from '@playwright/test';

// Chromium já instalado no ambiente; em outra máquina, remova executablePath e rode `npx playwright install chromium`.
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // PW_BASE permite testar o portal publicado numa subpasta (ex.: GitHub Pages).
    baseURL: `http://localhost:4173${process.env.PW_BASE ?? '/'}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
    launchOptions: { executablePath },
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: `http://localhost:4173${process.env.PW_BASE ?? '/'}`,
    reuseExistingServer: false,
    env: { BASE_PATH: process.env.PW_BASE ?? '/' },
  },
});
