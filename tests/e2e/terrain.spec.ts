import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { aimAt, diagnostics, startSolo, walkTo } from './helpers';
import { terrainCeiling, terrainFloor } from '../../src/shared/terrain';
import { generateWorld } from '../../src/shared/world';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorldServer } from '../../server/app';
import { gather } from './helpers';
import { testOrigins } from './server-options';

// DOM trace copies delay real input dispatch on software WebGL. Keep action and
// source traces plus explicit scene/failure images, as in the multiplayer suite.
test.use({
  trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true },
});

async function developerTerrain(page: Page): Promise<void> {
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Terrain', exact: true }).click();
}
async function stamp(
  page: Page,
  mode: string,
  x: number,
  y: number,
  z: number,
  radius: number,
): Promise<void> {
  const before = (await diagnostics(page)).terrain.revision;
  await page.locator('#dev-terrain-mode').selectOption(mode);
  await page.locator('#dev-terrain-shape').selectOption('box');
  for (const [field, value] of Object.entries({ x, y, z, radius }))
    await page.locator(`#dev-terrain-${field}`).fill(String(value));
  await page.getByRole('button', { name: 'Apply terrain brush', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).terrainMesh.revision).toBe(before + 1);
}
test('two ordinary online survivors see the same excavation and collide with it after reconnecting', async ({
  newContext,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const dir = await mkdtemp(join(tmpdir(), 'rbb-earthworks-browser-'));
  const server = await startWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    allowedOrigins: testOrigins,
    log: () => {},
  });
  const contextOptions = { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 0.5 };
  const contexts = await Promise.all([newContext(contextOptions), newContext(contextOptions)]);
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));

  const connect = async (page: Page) => {
    await page.getByRole('button', { name: 'Join a world' }).press('Enter');
    await page.getByLabel('World server', { exact: true }).fill(`ws://127.0.0.1:${server.port}`);
    await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
    await expect(page.locator('#hud')).toBeVisible();
    await expect.poll(async () => (await diagnostics(page)).mode).toBe('online');
  };
  try {
    for (const page of [a, b]) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
      await page.locator('#quality').selectOption('mobile');
      await page.getByText('Rendering effects', { exact: true }).press('Enter');
      await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
      await page.locator('[data-graphics="viewDistance"]').fill('0.5');
      await page.getByRole('button', { name: 'Apply settings' }).press('Enter');
      await connect(page);
    }
    await gather(a, 'starter-fiber', 1);
    await gather(a, 'starter-tree', 2);
    await gather(a, 'starter-rock', 3);
    await a.keyboard.press('Tab');
    await a.locator('[data-action="craft"][data-value="pickaxe"]').click();
    await expect.poll(async () => (await diagnostics(a)).player.inventory.pickaxe).toBe(1);
    await a.getByRole('button', { name: 'Close panel' }).click();
    await walkTo(a, 0, 94);
    await aimAt(a, 0, 8, 90);
    await a.keyboard.press('KeyT');
    await a.getByRole('button', { name: 'Dig terrain', exact: false }).click();
    await a.keyboard.press('KeyE');
    await expect.poll(async () => (await diagnostics(a)).terrainMesh.revision).toBe(1);
    await expect.poll(async () => (await diagnostics(b)).terrainMesh.revision).toBe(1);
    const edited = await diagnostics(a);
    expect((await diagnostics(b)).terrain).toEqual(edited.terrain);
    expect(edited.sandbox).toBe(false);
    expect(edited.devAllowed).toBe(false);
    expect(edited.player.inventory.dirt).toBeGreaterThan(0);
    expect((await diagnostics(b)).player.inventory.dirt).toBeUndefined();
    await walkTo(b, 0, 90);
    await expect.poll(async () => (await diagnostics(b)).player.position.y).toBeLessThan(7.8);
    await b.screenshot({ path: testInfo.outputPath('replicated-pit-collision.png') });
    const survivorId = (await diagnostics(b)).player.id;
    await b.reload();
    await connect(b);
    await expect.poll(async () => (await diagnostics(b)).terrainMesh.revision).toBe(1);
    expect((await diagnostics(b)).player.id).toBe(survivorId);
    expect((await diagnostics(b)).terrain).toEqual(edited.terrain);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('player controls excavate, deposit dirt and flatten visible terrain with a live mesh preview', async ({
  page,
}, testInfo) => {
  await startSolo(page, 'mobile');
  await page.keyboard.press('F2');
  await page.getByRole('button', { name: 'Replace pack with test kit' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await aimAt(page, 0, 8, 82);
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Dig terrain', exact: false }).click();
  await expect.poll(async () => (await diagnostics(page)).terrainTool.hit !== null).toBe(true);
  await expect(page.locator('#terrain-hint')).toContainText('DIG');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).terrain.revision).toBe(1);
  const dug = await diagnostics(page);
  expect(dug.player.inventory.dirt).toBeGreaterThan(100);
  expect(dug.terrainMesh.triangles).toBeGreaterThan(51_200);
  const world = generateWorld('quiet-frontier');
  const floor = terrainFloor(dug.terrain, world, 0, 82.4);
  expect(floor).toBeLessThan(8);
  await page.screenshot({ path: testInfo.outputPath('player-dug-pit.png') });
  await aimAt(page, 0, floor, 82.4);
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Deposit dirt', exact: false }).click();
  await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
  const depositTarget = (await diagnostics(page)).terrainTool.hit!.point;
  const beforeDepositHeight = terrainFloor(dug.terrain, world, depositTarget.x, depositTarget.z);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).terrain.revision).toBe(2);
  const filled = await diagnostics(page);
  expect(filled.player.inventory.dirt).toBeLessThan(dug.player.inventory.dirt!);
  const moundHeight = terrainFloor(filled.terrain, world, depositTarget.x, depositTarget.z);
  expect(moundHeight).toBeGreaterThan(beforeDepositHeight);
  await aimAt(page, depositTarget.x, moundHeight, depositTarget.z);
  await page.keyboard.press('KeyT');
  await page.locator('#terrain-level').fill('9');
  await page.getByRole('button', { name: 'Flatten ground', exact: false }).click();
  await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).terrain.revision).toBe(3);
  await page.keyboard.press('KeyR');
  expect((await diagnostics(page)).terrainTool.level).toBeGreaterThan(6);
  await page.screenshot({ path: testInfo.outputPath('player-flattened-ground.png') });
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Put terrain tools away' }).click();
  expect((await diagnostics(page)).terrainTool.mode).toBeNull();
});

test('a survivor digs into a hillside with a pickaxe and enters the tunnel below its roof', async ({
  page,
}, testInfo) => {
  await startSolo(page, 'mobile');
  // Only prepare the hill and tool through the visible developer UI. Every cut
  // below uses the ordinary player command, including its reach and dirt cost.
  await developerTerrain(page);
  await stamp(page, 'add', 12, 12, 78, 4);
  await page.getByRole('tab', { name: 'Inspector' }).click();
  await page.locator('#dev-item').selectOption('pickaxe');
  await page.locator('#dev-amount').fill('1');
  await page.getByRole('button', { name: 'Grant item', exact: true }).click();
  await page.locator('#dev-x').fill('12');
  await page.locator('#dev-z').fill('85');
  await page.getByRole('button', { name: 'Teleport', exact: true }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await aimAt(page, 12, 9.65, 78);
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Dig terrain', exact: false }).click();
  for (let revision = 2; revision <= 3; revision++) {
    await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await diagnostics(page)).terrain.revision).toBe(revision);
  }
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Put terrain tools away' }).click();
  await page.screenshot({ path: testInfo.outputPath('hand-dug-cave-entrance.png') });
  await walkTo(page, 12, 81, 0.4);
  const dug = await diagnostics(page);
  const world = generateWorld('quiet-frontier');
  const { x, y, z } = dug.player.position;
  expect(z).toBeLessThan(82);
  expect(y).toBeLessThan(9);
  expect(terrainCeiling(dug.terrain, world, x, z, y)).toBeLessThan(12);
  expect(terrainFloor(dug.terrain, world, x, z)).toBeGreaterThan(15);
  expect(dug.player.inventory.dirt).toBeGreaterThan(0);
  expect(dug.player.dev.freeBuild).toBe(false);
  await aimAt(page, 12, 10.5, 79);
  await page.screenshot({ path: testInfo.outputPath('hand-dug-hillside-tunnel.png') });
});

test('developer brushes form a hillside cave that can be entered, built in, saved and restored', async ({
  page,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);

  await startSolo(page, 'mobile');
  await developerTerrain(page);
  await stamp(page, 'add', 12, 12, 78, 4);
  await stamp(page, 'dig', 12, 10, 81, 2);
  await stamp(page, 'dig', 12, 10, 78, 2);
  await page.getByRole('tab', { name: 'Quick tools' }).click();
  await page.getByRole('checkbox', { name: 'Free building', exact: true }).check();
  await page.getByRole('tab', { name: 'Inspector' }).click();
  await page.locator('#dev-x').fill('12');
  // Set the fixture's entrance position through the visible developer control.
  // The later keyboard walk into the cave verifies collision and entry.
  await page.locator('#dev-z').fill('84');
  await page.getByRole('button', { name: 'Teleport', exact: true }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await aimAt(page, 12, 9.65, 78);
  await page.keyboard.press('KeyB');
  await page.getByRole('button', { name: 'Bedroll', exact: false }).click();
  await expect.poll(async () => (await diagnostics(page)).build?.y).toBe(8);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).buildings.length).toBe(1);
  await page.keyboard.press('KeyB');
  // Stay inside the cave but clear of the bedroll's 16 cm collision surface.
  // The entire navigation tolerance must land on the floor being asserted.
  await walkTo(page, 12, 81);
  expect((await diagnostics(page)).player.position.y).toBeCloseTo(8, 1);
  const bed = (await diagnostics(page)).buildings[0];
  await aimAt(page, bed.x, bed.y + 0.2, bed.z);
  await page.screenshot({ path: testInfo.outputPath('inside-cave-base.png') });
  const before = await diagnostics(page);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).terrainMesh.revision).toBe(3);
  expect((await diagnostics(page)).terrain).toEqual(before.terrain);
  expect((await diagnostics(page)).buildings).toEqual(before.buildings);
  expect((await diagnostics(page)).player.position.y).toBeCloseTo(8, 1);
  await page.screenshot({ path: testInfo.outputPath('cave-after-reload.png') });
  await developerTerrain(page);
  await page.getByRole('button', { name: 'Restore checkpoint', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).terrainMesh.samples).toBe(0);
  expect((await diagnostics(page)).buildings).toEqual([]);
});
