import { test, expect, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TF = process.env.TF2_DIR ?? '';
const hasTf2 = !!TF && existsSync(join(TF, 'tf2_misc_dir.vpk'));

/** Fail the test if the page talks to any origin other than the app itself. */
function trackForeignRequests(page: Page) {
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['http:', 'https:'].includes(u.protocol)) return;
    if (u.host !== 'localhost:4173') foreign.push(r.url());
  });
  return foreign;
}

async function createMannequin(page: Page, name: string) {
  await page.goto('/editor');
  await page.getByRole('button', { name: /SFMC Mannequin/ }).click();
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}/);
  const title = page.getByLabel('Character name').first();
  await title.fill(name);
}

/**
 * WebGL canvases are not readable after compositing (no preserveDrawingBuffer), so measure the
 * element screenshot instead: an empty dark viewport compresses to a tiny PNG, a rendered model does not.
 */
/** Each test runs in a fresh browser context (empty IndexedDB), so seed a saved character. */
async function seedCharacter(page: Page) {
  await createMannequin(page, 'E2E Mannequin');
  await page.getByRole('tab', { name: 'Cosmetics' }).click();
  await page.getByLabel('Search cosmetics').fill('#30066');
  await page.getByRole('option', { name: /Brotherhood of Arms/ }).first().click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved version 1/)).toBeVisible();
}

async function canvasHasPixels(page: Page) {
  const shot = await page.locator('canvas.viewer-canvas').first().screenshot();
  return Math.round(shot.length / 1024);
}

test('create, describe, save and reload a character', async ({ page }) => {
  const foreign = trackForeignRequests(page);
  await createMannequin(page, 'E2E Mannequin');
  await expect(page.locator('canvas.viewer-canvas')).toBeVisible();
  await expect.poll(() => canvasHasPixels(page), { timeout: 20_000 }).toBeGreaterThan(25);

  // Equip two catalog items (metadata only on the mannequin) and check undo/redo.
  await page.getByRole('tab', { name: 'Cosmetics' }).click();
  await page.getByLabel('Search cosmetics').fill('Brotherhood of Arms');
  await page.getByRole('option', { name: /Brotherhood of Arms/ }).first().click();
  await page.getByLabel('Search cosmetics').fill('#30066');
  await expect(page.getByRole('option', { name: /Brotherhood of Arms/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Search cosmetics').fill('Bonk Boy');
  await page.getByRole('option', { name: /Bonk Boy/ }).first().click();
  await expect(page.getByRole('tab', { name: /Equipped 2/ })).toBeVisible();
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(page.getByRole('tab', { name: /Equipped 1/ })).toBeVisible();
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect(page.getByRole('tab', { name: /Equipped 2/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.getByLabel('Personality and behaviour').fill('Energetic, sarcastic');
  await page.getByLabel('Description', { exact: true }).fill('Test description written by the E2E suite.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved version 1/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Character name').first()).toHaveValue('E2E Mannequin');
  await page.getByRole('tab', { name: 'Profile' }).click();
  await expect(page.getByLabel('Personality and behaviour')).toHaveValue('Energetic, sarcastic');
  await expect(page.getByRole('tab', { name: /Equipped 2/ })).toBeVisible();

  await page.goto('/characters');
  await expect(page.getByText('E2E Mannequin')).toBeVisible();
  expect(foreign, `third-party requests: ${foreign.join(', ')}`).toEqual([]);
});

test('exports manifest, markdown and PNG', async ({ page }) => {
  await seedCharacter(page);
  await page.getByRole('link', { name: 'Exports' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Mannequin' })).toBeVisible();
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Manifest JSON' }).click()]);
  const manifest = JSON.parse(await (await json.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(manifest.format).toBe('sfmc.character.manifest');
  expect(manifest.cosmetics.map((c: { defindex: number }) => c.defindex)).toContain(30066);
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown spec' }).click()]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);
  await expect(page.getByRole('button', { name: /Export PNG/ })).toBeEnabled({ timeout: 20_000 });
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export PNG/ }).click()]);
  const buf = Buffer.concat(await (await png.createReadStream()).toArray());
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(2048);
});

test('backup, wipe and restore the library', async ({ page }) => {
  await seedCharacter(page);
  await page.goto('/backups');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download ZIP backup' }).click()]);
  const path = await dl.path();
  expect(dl.suggestedFilename()).toMatch(/^sfmc-backup-.*\.zip$/);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete all local data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForURL('**/');
  await page.goto('/characters');
  await expect(page.getByText('Your library is empty')).toBeVisible();

  await page.goto('/backups');
  await page.locator('input[type=file][accept=".zip"]').setInputFiles(path);
  await expect(page.getByText('Integrity verified')).toBeVisible();
  await page.getByRole('button', { name: /^Restore/ }).click();
  await expect(page.getByText(/Restored: 1 added/)).toBeVisible();
  await page.goto('/characters');
  await expect(page.getByText('E2E Mannequin')).toBeVisible();
});

test('rejects files that are not backups', async ({ page }) => {
  await page.goto('/backups');
  await page.locator('input[type=file][accept=".zip"]').setInputFiles({ name: 'evil.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await expect(page.locator('.toast.error')).toBeVisible();
});

test.describe('with local TF2 files', () => {
  test.skip(!hasTf2, 'TF2 not installed');
  test.setTimeout(300_000);
  test('links VPKs via file input and renders a real Scout with a cosmetic', async ({ page }) => {
    const foreign = trackForeignRequests(page);
    const files = readdirSync(TF).filter((f) => /^tf2_(misc|textures)_(dir|\d{3})\.vpk$/.test(f)).map((f) => join(TF, f));
    await page.goto('/imports');
    await page.locator('input[type=file][accept=".vpk"]').setInputFiles(files);
    await expect(page.getByText(/Linked 2 VPK sets/)).toBeVisible({ timeout: 60_000 });

    // File-input links are session-only, so stay inside the SPA (no full reload).
    await page.getByRole('link', { name: 'Models' }).click();
    await page.getByRole('row', { name: /^Scout/ }).getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => canvasHasPixels(page), { timeout: 30_000 }).toBeGreaterThan(40);
    await page.getByRole('tab', { name: 'Cosmetics' }).click();
    await page.getByLabel('Search cosmetics').fill('Brotherhood of Arms');
    await page.getByRole('option', { name: /Brotherhood of Arms/ }).first().click();
    await expect(page.locator('.equip .badge.ok', { hasText: '3D' })).toBeVisible({ timeout: 30_000 });
    expect(foreign).toEqual([]);
  });
});
