import { test, expect } from '@playwright/test';
import { aimAt, diagnostics, gather, startSolo, walkTo } from './helpers';
import type { Diagnostics } from './helpers';
import { startWorldServer } from '../../server/app';
import { testOrigins } from './server-options';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Concurrent software WebGL scenes can delay trace copies before inputs/reads.
// Keep action/source traces and explicit milestone/failure images, as in multiplayer.
test.use({
  trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true },
});

test('survivor gathers, crafts, builds, exports and resumes a saved expedition', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Keep long interaction checks responsive on runners without a GPU.
  await startSolo(page, 'mobile');
  await page.screenshot({ path: testInfo.outputPath('first-footprints.png') });
  await gather(page, 'starter-fiber', 1);
  await gather(page, 'starter-tree', 6);
  await gather(page, 'starter-rock', 6);
  let d = await diagnostics(page);
  expect(d.player.inventory).toMatchObject({ wood: 36, stone: 30, fiber: 6 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('heading', { name: 'A life, in your pack.' })).toBeVisible();
  await page.locator('[data-action="craft"][data-value="hatchet"]').click();
  await expect.poll(async () => (await diagnostics(page)).player.inventory.hatchet).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('crafting.png') });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await walkTo(page, 0, 94);
  await page.keyboard.press('KeyB');
  await page.locator('[data-action="select-build"][data-value="foundation"]').click();
  await aimAt(page, 0, 9.65, 104);
  await expect(page.locator('#build-hint')).not.toHaveClass(/invalid/);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).buildings.length).toBe(1);
  await page.keyboard.press('KeyB');
  d = await diagnostics(page);
  expect(d.player.milestones).toMatchObject({ craft: 1, build: 1 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Take a breath.' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save' }).click();
  const exported = await download;
  await exported.saveAs(testInfo.outputPath('expedition.json'));
  const savedInventory = d.player.inventory;
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).click();
  await expect.poll(async () => (await diagnostics(page)).buildings.length).toBe(1);
  expect((await diagnostics(page)).player.inventory).toEqual(savedInventory);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#island-map')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('island-map.png') });
  expect(errors).toEqual([]);
});

test('menu, settings, pause, movement and jump work without browser errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('main-menu.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('#quality')).toBeFocused();
  await page.locator('#quality').selectOption('mobile');
  await page.locator('#show-stats').check();
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await page.getByRole('button', { name: 'Enter the frontier' }).click();
  await page.keyboard.down('KeyS');
  try {
    await expect.poll(async () => (await diagnostics(page)).player.position.z).toBeGreaterThan(87);
  } finally {
    await page.keyboard.up('KeyS');
  }
  const jumped = page.waitForFunction(
    () =>
      (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics().player.position
        .y > 8.3,
  );
  await page.keyboard.press('Space');
  await jumped;
  await page.keyboard.press('Escape');
  const tick = (await diagnostics(page)).tick;
  await page.waitForTimeout(200);
  expect((await diagnostics(page)).tick).toBe(tick);
  await page.getByRole('button', { name: 'Return to the wild' }).click();
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(tick);
  expect(errors).toEqual([]);
});

test('online survivor automatically reconnects after a world process restart', async ({ page }) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rbb-browser-restart-'));
  let server = await startWorldServer({
    allowedOrigins: testOrigins,
    port: 0,
    host: '127.0.0.1',
    dataDir,
    log: () => {},
  });
  const port = server.port;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Join a world' }).click();
    await page.locator('#server-url').fill(`ws://127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Join world', exact: true }).click();
    await expect.poll(async () => (await diagnostics(page)).mode).toBe('online');
    const id = (await diagnostics(page)).player.id;
    await server.close();
    await expect(page.locator('#save-indicator')).toContainText(/reconnect/i);
    server = await startWorldServer({
      allowedOrigins: testOrigins,
      port,
      host: '127.0.0.1',
      dataDir,
      log: () => {},
    });
    await expect(page.locator('#save-indicator')).toContainText('Connected');
    expect((await diagnostics(page)).player.id).toBe(id);
  } finally {
    await page.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('a graphics-context interruption pauses solo play and reload restores the save', async ({
  page,
}) => {
  await startSolo(page);
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyS');
  await page.evaluate(() =>
    document
      .querySelector('canvas')!
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!
      .loseContext(),
  );
  await expect(page.locator('#fatal')).toBeVisible();
  const before = await diagnostics(page);
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).tick).toBe(before.tick);
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).click();
  expect((await diagnostics(page)).player.position.z).toBeCloseTo(before.player.position.z, 2);
});

test('two browsers join a persistent authoritative world and resume a survivor', async ({
  browser,
}, testInfo) => {
  const contextOptions = { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 0.5 };
  const contexts = await Promise.all([
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
  ]);
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (const page of [a, b]) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
      await page.locator('#quality').selectOption('mobile');
      await page.getByText('Rendering effects', { exact: true }).press('Enter');
      await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
      await page.locator('[data-graphics="viewDistance"]').fill('0.5');
      await page.getByRole('button', { name: 'Apply settings' }).press('Enter');
      await page.getByRole('button', { name: 'Join a world' }).press('Enter');
      await page.locator('#server-url').fill('ws://127.0.0.1:8788');
      await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
      await expect(page.locator('#hud')).toBeVisible();
      await expect.poll(async () => (await diagnostics(page)).mode).toBe('online');
    }
    const id = (await diagnostics(a)).player.id;
    await b.keyboard.press('Escape');
    await b.screenshot({ path: testInfo.outputPath('shared-world.png') });
    await a.reload();
    await a.getByRole('button', { name: 'Join a world' }).press('Enter');
    await a.locator('#server-url').fill('ws://127.0.0.1:8788');
    await a.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
    await expect.poll(async () => (await diagnostics(a)).player?.id).toBe(id);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
