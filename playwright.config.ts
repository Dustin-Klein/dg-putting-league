import { defineConfig, devices } from '@playwright/test';

// Visual regression tests: screenshots of the main public and scoring pages,
// compared with the baselines in e2e/visual/__screenshots__. They need the local
// stack seeded with e2e/visual/seed.ts and a production build (`npm run build`)
// made with the local Supabase env. Baselines are rendered on the CI runner;
// regenerate them with the "Update visual baselines" workflow, not locally.
const baseURL = 'http://127.0.0.1:3000';
const lightTheme = { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: 'theme', value: 'light' }] }] };

export default defineConfig({
  testDir: './e2e/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a missing baseline is written on the first attempt, so a retry
  // would pass and hide it.
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Absorbs anti-aliasing noise; a real layout or color change is far larger.
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    colorScheme: 'light',
    timezoneId: 'America/Chicago',
    locale: 'en-US',
  },
  // Dark is the app's default theme. The light projects pick light the way a user
  // would: next-themes reads the stored choice from localStorage.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, storageState: lightTheme } },
    { name: 'mobile', use: { ...devices['Pixel 7'], storageState: lightTheme } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' } },
    { name: 'mobile-dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
