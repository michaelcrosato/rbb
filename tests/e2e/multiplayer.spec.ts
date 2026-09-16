import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorldServer } from '../../server/app';
import { aimAt, diagnostics, gather, walkTo } from './helpers';

// DOM trace snapshots are awaited before input dispatch. Across five software
// WebGL contexts that delays key releases; keep action/source traces
// and the explicit milestone/failure screenshots without per-action DOM copies.
test.use({
  trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true },
});

function observeErrors(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /GL_INVALID|WebGL:|cannot be cloned/.test(message.text()))
      errors.push(message.text());
  });
}

async function prepare(page: Page, errors: string[]) {
  observeErrors(page, errors);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
  await page.locator('#quality').selectOption('mobile');
  await page.getByText('Rendering effects', { exact: true }).press('Enter');
  await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
  await page.locator('[data-graphics="viewDistance"]').fill('0.5');
  await page.getByRole('button', { name: 'Apply settings' }).press('Enter');
}

async function connect(page: Page, url: string, name: string) {
  await page.getByRole('button', { name: 'Join a world' }).press('Enter');
  await page.getByLabel('World server', { exact: true }).fill(url);
  await page.getByLabel('Survivor name').fill(name);
  await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).mode).toBe('online');
}

test('session controls are ready before the first game frame after joining or returning to solo', async ({
  page,
}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rbb-session-ui-'));
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', dataDir, log: () => {} });
  const errors: string[] = [];
  try {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await prepare(page, errors);
    await expect.poll(async () => (await diagnostics(page)).renderer.drawCalls).toBeGreaterThan(0);
    // Keep the rendered menu, but delay the next application frame. Joining and
    // opening menus still use real network events and keyboard controls.
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    await connect(page, `ws://127.0.0.1:${server.port}`, 'Immediate crew');
    await expect(page.getByRole('button', { name: 'Crew and invite' })).toBeVisible();
    if ((await diagnostics(page)).panel !== 'pause')
      await page.getByRole('button', { name: 'Pause', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: 'Crew & invite' })).toBeVisible();
    await page.getByRole('button', { name: 'Leave world & return to menu' }).press('Enter');
    await page.getByRole('button', { name: 'Enter the frontier' }).press('Enter');
    await expect(page.locator('#hud')).toBeVisible();
    if ((await diagnostics(page)).panel !== 'pause')
      await page.getByRole('button', { name: 'Pause', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: 'Save & return to menu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crew & invite' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('four survivors play in one world, share a camp and invite, and free a full-world slot', async ({
  browser,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 360000 : 180000);
  const dataDir = await mkdtemp(join(tmpdir(), 'rbb-four-browser-'));
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', dataDir, log: () => {} });
  // Five software-rendered worlds share one CI runner. Bound raster work while
  // preserving the desktop layout and all gameplay assertions.
  const contextOptions = { viewport: { width: 1024, height: 640 }, deviceScaleFactor: 0.5 };
  const contexts = [await browser.newContext(contextOptions)];
  const errors: string[] = [];
  const serverUrl = `ws://127.0.0.1:${server.port}/`;
  try {
    const a = await contexts[0].newPage();
    await prepare(a, errors);
    // Configure graphics through the real UI once, before creating any survivor.
    // Reuse only those saved preferences in independent browser contexts, avoiding
    // repeated full-resolution startup and world reloads on software-rendered CI.
    const preferences = await contexts[0].storageState();
    const peerContexts = await Promise.all(
      Array.from({ length: 4 }, () =>
        browser.newContext({ ...contextOptions, storageState: preferences }),
      ),
    );
    contexts.push(...peerContexts);
    const [b, c, d, overflow] = await Promise.all(peerContexts.map((context) => context.newPage()));
    await connect(a, serverUrl, 'Avery');
    await a.keyboard.press('Escape');
    await expect(a.getByRole('button', { name: 'Crew & invite' })).toBeVisible();
    await a.getByRole('button', { name: 'Crew & invite' }).press('Enter');
    await expect(a.locator('#crew-count')).toHaveText('1 / 4 survivors');
    const invite = await a.getByLabel('Invite friends').inputValue();
    expect([...new URL(invite).searchParams.keys()]).toEqual(['world']);
    expect(new URL(invite).searchParams.get('world')).toBe(serverUrl);
    await contexts[0].grantPermissions(['clipboard-read', 'clipboard-write']);
    await a.getByRole('button', { name: 'Copy invite link' }).click();
    expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(invite);

    for (const [i, page] of [b, c, d, overflow].entries()) {
      observeErrors(page, errors);
      await page.goto(invite);
      await expect(page.getByRole('heading', { name: 'Better with company.' })).toBeVisible();
      await expect(page.getByLabel('World server', { exact: true })).toHaveValue(serverUrl);
      await page.getByLabel('Survivor name').fill(['Blair', 'Cameron', 'Drew', 'Extra'][i]);
      await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
      if (page !== overflow) await expect(page.locator('#hud')).toBeVisible();
    }
    await expect(overflow.locator('#connect-status')).toContainText('World full (4/4)');
    await expect(a.locator('#crew-list li')).toHaveCount(4);
    await expect(a.locator('#crew-count')).toHaveText('4 / 4 survivors');
    await a.screenshot({ path: testInfo.outputPath('four-player-crew.png') });
    await a.getByRole('button', { name: 'Close panel' }).press('Enter');

    const active = [a, b, c, d];
    const before = await Promise.all(active.map(diagnostics));
    expect(new Set(before.map((state) => state.player.id)).size).toBe(4);
    await Promise.all(
      active.map(async (page, index) => {
        if ((await diagnostics(page)).panel)
          await page.getByRole('button', { name: 'Close panel' }).press('Enter');
        await page.keyboard.down('KeyS');
        try {
          await expect
            .poll(async () => (await diagnostics(page)).player.position.z)
            .toBeGreaterThan(before[index].player.position.z + 0.5);
        } finally {
          await page.keyboard.up('KeyS');
        }
      }),
    );
    for (const page of active) {
      await expect.poll(async () => (await diagnostics(page)).players.length).toBe(3);
      await expect
        .poll(async () => (await diagnostics(page)).remoteSurvivors.filter((p) => p.visible).length)
        .toBe(3);
      const state = await diagnostics(page);
      expect(state.players.every((p) => !('inventory' in p))).toBe(true);
      expect(state.renderer.drawCalls).toBeGreaterThan(0);
      expect(state.sandbox).toBe(false);
    }
    const moved = await Promise.all(active.map(diagnostics));
    for (const [index, page] of active.entries()) {
      for (const other of moved.filter((_, otherIndex) => otherIndex !== index)) {
        await expect
          .poll(async () => {
            const remote = (await diagnostics(page)).remoteSurvivors.find(
              (p) => p.id === other.player.id,
            );
            return remote
              ? Math.hypot(
                  remote.position.x - other.player.position.x,
                  remote.position.z - other.player.position.z,
                )
              : Infinity;
          })
          .toBeLessThan(0.3);
      }
    }

    // All four take real commands. Only Avery receives the gathered materials.
    for (const page of [b, c, d]) await page.keyboard.press('KeyF');
    await gather(a, 'starter-fiber', 1);
    await gather(a, 'starter-tree', 6);
    await gather(a, 'starter-rock', 6);
    for (const page of [b, c, d]) {
      await expect
        .poll(async () => (await diagnostics(page)).mutations['starter-tree']?.health)
        .toBe(0);
      expect((await diagnostics(page)).player.inventory).toEqual({ rock: 1, berries: 2 });
    }
    await a.keyboard.press('Tab');
    await a.locator('[data-action="craft"][data-value="hatchet"]').press('Enter');
    await expect.poll(async () => (await diagnostics(a)).player.inventory.hatchet).toBe(1);
    await a.getByRole('button', { name: 'Close panel' }).press('Enter');
    await walkTo(a, 0, 94);
    await a.keyboard.press('KeyB');
    await a.locator('[data-action="select-build"][data-value="foundation"]').press('Enter');
    await aimAt(a, 0, 9.65, 104);
    await expect(a.locator('#build-hint')).not.toHaveClass(/invalid/);
    await a.keyboard.press('KeyE');
    for (const page of active)
      await expect.poll(async () => (await diagnostics(page)).buildings.length).toBe(1);
    const building = (await diagnostics(a)).buildings[0];
    for (const page of [b, c, d]) expect((await diagnostics(page)).buildings[0]).toEqual(building);
    await a.keyboard.press('KeyB');
    await b.keyboard.press('KeyM');
    await expect(b.locator('#island-map')).toBeVisible();
    await expect
      .poll(() =>
        b
          .locator('#island-map')
          .evaluate(
            (canvas) =>
              (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
          ),
      )
      .toBe(255);
    await b.screenshot({ path: testInfo.outputPath('four-player-map.png') });

    // Observe another survivor moving through both network state and WebGL presentation.
    await b.getByRole('button', { name: 'Close panel' }).press('Enter');
    await walkTo(c, -2, 94);
    await walkTo(d, 2, 94);
    const aPosition = (await diagnostics(a)).player.position;
    await aimAt(b, aPosition.x, aPosition.y + 1.3, aPosition.z);
    await b.screenshot({ path: testInfo.outputPath('four-player-world.png') });
    await a.keyboard.press('Escape');
    const leftId = (await diagnostics(a)).player.id;
    await a.getByRole('button', { name: 'Leave world & return to menu' }).press('Enter');
    await expect.poll(async () => (await diagnostics(b)).players.length).toBe(2);
    await expect
      .poll(async () => (await diagnostics(b)).remoteSurvivors.some((p) => p.id === leftId))
      .toBe(false);
    await overflow.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
    await expect(overflow.locator('#hud')).toBeVisible();
    await expect.poll(async () => (await diagnostics(overflow)).players.length).toBe(3);
    expect((await diagnostics(overflow)).buildings[0]).toEqual(building);
    expect(server.diagnostics()).toMatchObject({ connections: 4, healthy: true });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('separate survivors in the same browser retain their identities across reloads', async ({
  browser,
}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rbb-tabs-'));
  const server = await startWorldServer({ port: 0, host: '127.0.0.1', dataDir, log: () => {} });
  const context = await browser.newContext();
  const a = await context.newPage(),
    b = await context.newPage();
  const errors: string[] = [];
  const url = `ws://127.0.0.1:${server.port}`;
  try {
    await prepare(a, errors);
    await connect(a, url, 'First');
    const first = (await diagnostics(a)).player.id;
    observeErrors(b, errors);
    await b.goto('/');
    await b.getByRole('button', { name: 'Join a world' }).press('Enter');
    await b.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
    await expect(b.locator('#connect-status')).toContainText('already connected');
    await b.getByLabel('Survivor name').fill('Second');
    await b.getByRole('checkbox', { name: 'Start a new survivor' }).check();
    await b.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
    await expect(b.locator('#hud')).toBeVisible();
    const second = (await diagnostics(b)).player.id;
    expect(first).not.toBe(second);
    for (const [page, id, name] of [
      [a, first, 'First'],
      [b, second, 'Second'],
    ] as const) {
      await page.reload();
      await page.getByRole('button', { name: 'Join a world' }).press('Enter');
      await page.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
      await expect.poll(async () => (await diagnostics(page)).player?.id).toBe(id);
      expect((await diagnostics(page)).player.name).toBe(name);
    }
    expect(server.diagnostics()).toMatchObject({ players: 2, connections: 2 });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
