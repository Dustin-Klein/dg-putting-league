import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const seed: { leagueId: string; eventId: string; accessCode: string; playerNumber: number } = JSON.parse(
  readFileSync(path.join(__dirname, '.seed.json'), 'utf8')
);

// The bracket marks a match idle 2 minutes after it gets a lane. A fixed clock well
// after the seed makes every laned match idle, whenever the tests run.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T18:00:00Z') });
});

async function snap(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

test('home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep score from your phone.' })).toBeVisible();
  await snap(page, 'home');
});

test('login', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('button', { name: /log ?in|sign ?in/i })).toBeVisible();
  await snap(page, 'login');
});

test('leagues', async ({ page }) => {
  await page.goto('/leagues');
  await expect(page.getByText('Thursday Night Putting')).toBeVisible();
  await snap(page, 'leagues');
});

test('league', async ({ page }) => {
  await page.goto(`/leagues/${seed.leagueId}`);
  await expect(page.getByRole('heading', { name: 'Thursday Night Putting' })).toBeVisible();
  await snap(page, 'league');
});

test('bracket', async ({ page }) => {
  await page.goto(`/event/${seed.eventId}/bracket`);
  await expect(page.getByText('Avery Lund').first()).toBeVisible();
  await snap(page, 'bracket');
});

test('players', async ({ page }) => {
  await page.goto('/players');
  // The page lists nothing until a search.
  await page.getByPlaceholder('Search players...').fill('Avery');
  await expect(page.getByText('Avery Lund').first()).toBeVisible();
  await snap(page, 'players');
});

test('player', async ({ page }) => {
  await page.goto(`/player/${seed.playerNumber}`);
  await expect(page.getByText('Avery Lund').first()).toBeVisible();
  await snap(page, 'player');
});

test('score entry', async ({ page }) => {
  await page.goto('/score');
  await expect(page.getByLabel('Access Code')).toBeVisible();
  await snap(page, 'score-entry');
});

test('scoring: match list and match', async ({ page }) => {
  await page.goto('/score');
  await page.getByLabel('Access Code').fill(seed.accessCode);
  await page.getByLabel('Access Code').press('Enter');
  await page.waitForURL('**/score/matches');
  // The seed leaves one match partly scored.
  const inProgress = page.getByText('In Progress');
  await expect(inProgress).toBeVisible();
  await snap(page, 'score-matches');

  await inProgress.click();
  await page.waitForURL('**/score/match/**');
  await page.waitForLoadState('networkidle');
  await snap(page, 'score-match');
});
