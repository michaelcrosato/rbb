import { test, expect } from '@playwright/test';
import { aimAt, diagnostics, startSolo } from './helpers';
import { walkTo, gather } from './helpers';
import {
  craftRecipe,
  grantMaterials,
  importExpedition,
  inspectPiece,
  observeProgressionErrors,
  placePiece,
  travel,
} from './progression-helpers';
import { generateWorld } from '../../src/shared/world';
import { createState } from '../../src/shared/state';
import { Simulation } from '../../src/shared/simulation';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorldServer } from '../../server/app';
import { testOrigins } from './server-options';

test.use({
  // Keep the desktop layout and WebGL path while bounding software raster cost,
  // as in the multi-browser journeys. Hardware-quality evidence is separate.
  deviceScaleFactor: 0.5,
  trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true },
});

test('a ranged shot uses equipped ammunition, damages distant wildlife and leaves collectible hides', async ({
  page,
}, testInfo) => {
  const errors = observeProgressionErrors(page);
  await startSolo(page, 'mobile', 'keyboard');
  const world = generateWorld('quiet-frontier'),
    state = createState(world),
    sim = new Simulation(world, state),
    p = sim.addPlayer('local', 'Hunter');
  p.inventory = { rock: 1, bow: 1, arrow: 2 };
  p.quickSlots[0] = 'bow';
  state.tuning.wildlifeSpeed = 0;
  state.tuning.wildlifeAggression = 0;
  state.animals = [
    {
      id: `a${state.nextId++}`,
      species: 'boar',
      behavior: 'roam',
      x: 0,
      y: 8,
      z: 100,
      homeX: 0,
      homeZ: 100,
      health: 60,
      yaw: 0,
      cooldown: 0,
      respawnAt: 0,
    },
  ];
  await importExpedition(page, state);
  await page.keyboard.press('Digit1');
  await aimAt(page, 0, 8.5, 100);
  await expect.poll(async () => (await diagnostics(page)).target).toBe(state.animals[0].id);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).animals[0].health).toBe(24);
  await expect(page.locator('#weapon-status')).toContainText('1');
  await page.screenshot({ path: testInfo.outputPath('ranged-hunting.png') });
  await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await diagnostics(page)).animals[0].health).toBe(0);
  await expect.poll(async () => (await diagnostics(page)).bags.length).toBe(1);
  expect((await diagnostics(page)).player.inventory.arrow ?? 0).toBe(0);
  await walkTo(page, 0, 97.5, 0.3);
  const bag = (await diagnostics(page)).bags[0];
  await aimAt(page, bag.x, bag.y + 0.3, bag.z);
  await page.keyboard.press('KeyE');
  await page.getByRole('button', { name: 'Take all that fits', exact: false }).press('Enter');
  await expect.poll(async () => (await diagnostics(page)).player.inventory.leather).toBe(3);
  expect((await diagnostics(page)).bags).toEqual([]);
  expect(errors).toEqual([]);
});

test('landmark maps lead to persistent shared salvage and rich quarry veins', async ({
  page,
}, testInfo) => {
  const errors = observeProgressionErrors(page);
  await startSolo(page, 'mobile', 'keyboard');
  await page.keyboard.press('KeyM');
  await expect(page.locator('.site-card')).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath('landmarks-map.png') });
  await page.getByRole('button', { name: /Abandoned depot.*Track destination/ }).press('Enter');
  await expect(page.locator('#destination')).toContainText('Abandoned depot');
  const site = (await diagnostics(page)).sites.find((s) => s.kind === 'depot')!;
  await travel(page, site.x, site.z + 2.5);
  await aimAt(page, site.x, site.y + 0.5, site.z);
  await expect.poll(async () => (await diagnostics(page)).target).toBe(site.id);
  await page.screenshot({ path: testInfo.outputPath('depot-world.png') });
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('heading', { name: 'Abandoned depot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Take all that fits', exact: false }).press('Enter');
  await expect
    .poll(async () => (await diagnostics(page)).player.inventory.parts ?? 0)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Object.keys((await diagnostics(page)).siteStates[site.id].inventory).length)
    .toBe(0);
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).press('Enter');
  expect((await diagnostics(page)).siteStates[site.id].inventory).toEqual({});
  const quarry = (await diagnostics(page)).sites.find((s) => s.kind === 'ironQuarry')!;
  await travel(page, quarry.x, quarry.z + 3);
  const ore = (await diagnostics(page)).resources.find(
    (r) => r.kind === 'iron' && r.id.startsWith(quarry.id),
  )!;
  await grantMaterials(page, { ironPickaxe: 1 });
  await page.keyboard.press('Tab');
  await page.locator('[data-action="item"][data-value="ironPickaxe"]').press('Enter');
  await page.getByRole('button', { name: 'Manage Iron pickaxe' }).press('Enter');
  await page.getByLabel('Quick slot', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Assign slot' }).press('Enter');
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  await travel(page, ore.x, ore.z + 2.5);
  await page.keyboard.press('Digit3');
  await gather(page, ore.id, 1);
  expect((await diagnostics(page)).player.inventory.ironOre).toBe(20);
  await page.screenshot({ path: testInfo.outputPath('iron-quarry.png') });
  expect(errors).toEqual([]);
});

test('a workshop turns ore into equipment, firearms and reinforced shelter with working doors and storage', async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors = observeProgressionErrors(page);
  await startSolo(page, 'mobile', 'keyboard');
  await grantMaterials(page, {
    wood: 200,
    stone: 100,
    ironOre: 80,
    charcoal: 45,
    sulfurOre: 10,
    scrap: 40,
    parts: 6,
    cloth: 20,
    leather: 12,
    fiber: 50,
  });
  await craftRecipe(page, 'backpack');
  await page.locator('[data-action="wear"][data-value="backpack"]').press('Enter');
  await expect.poll(async () => (await diagnostics(page)).player.worn.backpack).toBe('backpack');
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  await walkTo(page, 0, 95, 0.3);
  const foundation = await placePiece(page, 'foundation', 0, 100);
  const frame = await placePiece(page, 'doorway', 0, 100);
  await inspectPiece(page, frame);
  await page.getByRole('button', { name: 'Upgrade structure', exact: true }).press('Enter');
  await expect
    .poll(async () => (await diagnostics(page)).buildings.find((b) => b.id === frame.id)?.grade)
    .toBe('stone');
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  const door = await placePiece(page, 'door', 0, 100);
  await inspectPiece(page, door);
  await page.getByRole('button', { name: 'Open door', exact: true }).press('Enter');
  await expect
    .poll(async () => (await diagnostics(page)).buildings.find((b) => b.id === door.id)?.open)
    .toBe(true);
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  await walkTo(page, foundation.x, foundation.z, 0.3);
  await expect
    .poll(async () => (await diagnostics(page)).player.position.y)
    .toBeCloseTo(foundation.y, 1);
  await placePiece(page, 'window', foundation.x + 5, foundation.z, 1);
  await placePiece(page, 'wall', foundation.x - 5, foundation.z, 3);
  await placePiece(page, 'roof', foundation.x, foundation.z + 5);
  await aimAt(page, frame.x, frame.y + 1.2, frame.z);
  await page.screenshot({ path: testInfo.outputPath('shelter-interior.png') });
  await walkTo(page, 0, 95, 0.4);
  await walkTo(page, -9, 90, 0.3);
  await placePiece(page, 'furnace', -9, 95);
  await walkTo(page, -9, 92.5, 0.3);
  await placePiece(page, 'workbench', -4, 92.5);
  await walkTo(page, -6.5, 92.5, 0.3);
  await craftRecipe(page, 'metal', 20);
  await craftRecipe(page, 'armor');
  await page.locator('[data-action="wear"][data-value="armor"]').press('Enter');
  await craftRecipe(page, 'scrapPistol');
  await craftRecipe(page, 'gunpowder', 1);
  await craftRecipe(page, 'cartridge', 1);
  await craftRecipe(page, 'reinforcedPlate', 3);
  await page.getByRole('button', { name: 'Weapons', exact: true }).press('Enter');
  await page.screenshot({ path: testInfo.outputPath('workshop-recipes.png') });
  await page.getByRole('button', { name: 'Manage Salvage pistol', exact: true }).press('Enter');
  await page.getByLabel('Quick slot', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Assign slot' }).press('Enter');
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  const chest = await placePiece(page, 'storage', -6.5, 98);
  await walkTo(page, chest.x, chest.z - 2.5, 0.3);
  await inspectPiece(page, chest);
  await page.getByLabel('Store Wood quantity', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Store Wood', exact: true }).press('Enter');
  await expect
    .poll(
      async () =>
        (await diagnostics(page)).buildings.find((b) => b.id === chest.id)?.inventory.wood,
    )
    .toBe(20);
  await page.screenshot({ path: testInfo.outputPath('shared-storage.png') });
  await page.getByLabel('Take Wood quantity', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Take Wood', exact: true }).press('Enter');
  await expect
    .poll(
      async () =>
        (await diagnostics(page)).buildings.find((b) => b.id === chest.id)?.inventory.wood,
    )
    .toBe(15);
  await page.getByRole('button', { name: 'Close panel' }).press('Enter');
  await walkTo(page, 0, 95, 0.3);
  await inspectPiece(page, frame);
  await page.getByRole('button', { name: 'Upgrade structure', exact: true }).press('Enter');
  await expect
    .poll(async () => (await diagnostics(page)).buildings.find((b) => b.id === frame.id)?.grade)
    .toBe('metal');
  await page.screenshot({ path: testInfo.outputPath('reinforced-structure.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).press('Enter');
  const restored = await diagnostics(page);
  expect(restored.player.worn).toEqual({ armor: 'armor', backpack: 'backpack' });
  expect(restored.player.quickSlots[0]).toBe('scrapPistol');
  expect(restored.buildings.find((b) => b.id === frame.id)?.grade).toBe('metal');
  expect(restored.buildings.find((b) => b.id === chest.id)?.inventory.wood).toBe(15);
  expect(errors).toEqual([]);
});

test('players build a stairwell, climb onto an upper floor and roof a second storey', async ({
  page,
}, testInfo) => {
  const errors = observeProgressionErrors(page);
  await startSolo(page, 'mobile', 'keyboard');
  await grantMaterials(page, { wood: 140, stone: 20, fiber: 40 });
  await walkTo(page, 0, 95, 0.3);
  const base = await placePiece(page, 'foundation', 0, 100);
  await placePiece(page, 'wall', 0, 100, 1);
  const landing = await placePiece(page, 'stairwell', 0, 100);
  await placePiece(page, 'stairs', 0, 100);
  await walkTo(page, -4, 100, 0.3);
  await walkTo(page, -4, 103, 0.3);
  await walkTo(page, 0, 103, 0.3);
  await walkTo(page, 0, 98.2, 0.15);
  // Keep the whole arrival tolerance clear of the wall's 45 cm placement buffer.
  await walkTo(page, 1.2, 98.5, 0.2);
  await expect
    .poll(async () => (await diagnostics(page)).player.position.y)
    .toBeCloseTo(base.y + 3, 1);
  const upperWall = await placePiece(page, 'window', 5, 100, 1);
  expect(upperWall.support).toBe(landing.id);
  const roof = await placePiece(page, 'roof', 0, 105);
  expect(roof.y).toBeCloseTo(base.y + 6);
  await aimAt(page, 0, landing.y + 1.3, 96);
  await page.screenshot({ path: testInfo.outputPath('upper-storey.png') });
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).press('Enter');
  expect((await diagnostics(page)).buildings.find((b) => b.id === roof.id)?.support).toBe(
    upperWall.id,
  );
  expect((await diagnostics(page)).player.position.y).toBeCloseTo(landing.y, 1);
  expect(errors).toEqual([]);
});

test('ordinary co-op survivors pass supplies through the real pack and ground-loot controls', async ({
  browser,
}, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), 'rbb-progression-browser-'));
  const server = await startWorldServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    allowedOrigins: testOrigins,
    log: () => {},
  });
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 0.5 }),
    browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 0.5 }),
  ]);
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [observeProgressionErrors(a), observeProgressionErrors(b)];
  try {
    for (const page of [a, b]) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
      await page.locator('#quality').selectOption('mobile');
      await page.getByText('Rendering effects', { exact: true }).press('Enter');
      await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
      await page.getByRole('button', { name: 'Apply settings' }).press('Enter');
      await page.getByRole('button', { name: 'Join a world' }).press('Enter');
      await page.getByLabel('World server', { exact: true }).fill(`ws://127.0.0.1:${server.port}`);
      await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
      await expect(page.locator('#hud')).toBeVisible();
    }
    await a.keyboard.press('Tab');
    await a.getByRole('button', { name: 'Manage Wild berries' }).press('Enter');
    await a.getByLabel('Quantity to drop').fill('2');
    await a.getByRole('button', { name: 'Drop supplies', exact: false }).press('Enter');
    await expect.poll(async () => (await diagnostics(b)).bags.length).toBe(1);
    const bag = (await diagnostics(b)).bags[0];
    await aimAt(b, bag.x, bag.y + 0.3, bag.z);
    await expect.poll(async () => (await diagnostics(b)).target).toBe(bag.id);
    await b.keyboard.press('KeyE');
    await b.getByRole('button', { name: 'Take all that fits', exact: false }).press('Enter');
    await expect.poll(async () => (await diagnostics(b)).player.inventory.berries).toBe(5);
    await expect.poll(async () => (await diagnostics(a)).bags.length).toBe(0);
    expect((await diagnostics(a)).player.inventory.berries).toBe(1);
    expect((await diagnostics(a)).sandbox).toBe(false);
    expect((await diagnostics(b)).devAllowed).toBe(false);
    await b.screenshot({ path: testInfo.outputPath('cooperative-transfer.png') });
    expect(errors.flat()).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('inventory controls split a ground stack, preserve it on reload, and collect selected quantities', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /GL_INVALID|WebGL:/.test(message.text()))
      errors.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await startSolo(page, 'mobile', 'keyboard');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Manage Wild berries', exact: true }).press('Enter');
  const quantity = page.getByLabel('Quantity to drop');
  await quantity.press('ControlOrMeta+A');
  // A first frame after opening must not replace the selected input. This used
  // to turn a native replacement keystroke into 12/21 instead of the intended 2.
  await page.clock.runFor(250);
  await page.keyboard.insertText('2');
  await expect(quantity).toHaveValue('2');
  await page.clock.resume();
  await page.screenshot({ path: testInfo.outputPath('split-stack.png') });
  await page.getByRole('button', { name: 'Drop supplies', exact: false }).press('Enter');
  await expect.poll(async () => (await diagnostics(page)).player.inventory.berries).toBe(1);
  await expect.poll(async () => (await diagnostics(page)).bags[0]?.inventory.berries).toBe(2);
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition', exact: true }).press('Enter');
  const bag = (await diagnostics(page)).bags[0];
  expect(bag.inventory.berries).toBe(2);
  await aimAt(page, bag.x, bag.y + 0.3, bag.z);
  await expect.poll(async () => (await diagnostics(page)).target).toBe(bag.id);
  await page.screenshot({ path: testInfo.outputPath('dropped-supplies.png') });
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('heading', { name: 'Ground supplies', exact: true })).toBeVisible();
  await page.getByLabel('Wild berries quantity').fill('1');
  await page.getByRole('button', { name: 'Take Wild berries', exact: true }).press('Enter');
  await expect.poll(async () => (await diagnostics(page)).player.inventory.berries).toBe(2);
  await expect.poll(async () => (await diagnostics(page)).bags[0]?.inventory.berries).toBe(1);
  await expect(page.getByText('1 available', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('partial-collection.png') });
  await page.getByRole('button', { name: 'Take all that fits', exact: false }).press('Enter');
  await expect.poll(async () => (await diagnostics(page)).player.inventory.berries).toBe(3);
  await expect.poll(async () => (await diagnostics(page)).bags.length).toBe(0);
  await expect(page.getByRole('heading', { name: 'Supplies moved.', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
