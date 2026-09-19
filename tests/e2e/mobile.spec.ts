import { test, expect } from '@playwright/test';
import { diagnostics, startSolo } from './helpers';

test('terrain tools excavate through touch controls and developer brushes fit both orientations', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /GL_INVALID|WebGL:/.test(m.text())) errors.push(m.text());
  });
  await startSolo(page, 'mobile');
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.getByRole('button', { name: 'Developer tools' }).tap();
  await page.getByRole('button', { name: 'Replace pack with test kit' }).tap();
  await page.getByRole('button', { name: 'Close panel' }).tap();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 220, y: 340, id: 1 }],
  });
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(20);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 220, y: 340 + i * 12.5, id: 1 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await diagnostics(page)).player.pitch).toBeLessThan(-0.3);
  await page.getByRole('button', { name: 'Terrain tools', exact: true }).tap();
  await page.screenshot({ path: testInfo.outputPath('terrain-tools-portrait.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Dig terrain', exact: false }).tap();
  await expect.poll(async () => (await diagnostics(page)).terrainTool.hit !== null).toBe(true);
  await page.getByRole('button', { name: 'Gather or place' }).tap();
  await expect.poll(async () => (await diagnostics(page)).terrainMesh.revision).toBe(1);
  expect((await diagnostics(page)).player.inventory.dirt).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('terrain-dug-touch.png') });
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.getByRole('button', { name: 'Developer tools' }).tap();
  await page.getByRole('tab', { name: 'Terrain', exact: true }).tap();
  await page.screenshot({ path: testInfo.outputPath('sculpt-tools-portrait.png') });
  await page.setViewportSize({ width: 915, height: 412 });
  await page.locator('#dev-terrain-mode').selectOption('add');
  await page.locator('#dev-terrain-x').fill('12');
  await page.locator('#dev-terrain-y').fill('8');
  await page.locator('#dev-terrain-z').fill('82');
  await page.locator('#dev-terrain-radius').fill('3');
  await page.getByRole('button', { name: 'Apply terrain brush' }).tap();
  await expect.poll(async () => (await diagnostics(page)).terrainMesh.revision).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sculpt-tools-landscape.png') });
  await page.getByRole('button', { name: 'Sculpt in world' }).tap();
  await expect(page.getByRole('button', { name: 'Gather or place' })).toBeInViewport();
  const hint = await page.locator('#terrain-hint').boundingBox();
  expect(hint!.y).toBeGreaterThan(412 / 2 + 12);
  await page.screenshot({ path: testInfo.outputPath('sculpt-world-landscape.png') });
  expect(errors).toEqual([]);
});

test('a four-survivor crew, invite and map fit portrait and landscape touch screens', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(process.env.CI ? 240000 : 120000);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext()));
  const teammates = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  try {
    for (const [i, survivor] of [page, ...teammates].entries()) {
      survivor.on('pageerror', (error) => errors.push(error.message));
      survivor.on('console', (message) => {
        if (message.type() === 'error' || /GL_INVALID|WebGL:|cannot be cloned/.test(message.text()))
          errors.push(message.text());
      });
      await survivor.goto('/');
      await survivor.getByRole('button', { name: 'Settings', exact: true }).press('Enter');
      await survivor.locator('#quality').selectOption('mobile');
      await survivor.getByText('Rendering effects', { exact: true }).press('Enter');
      await survivor.locator('[data-graphics="resolutionScale"]').fill('0.5');
      await survivor.getByRole('button', { name: 'Apply settings' }).press('Enter');
      await survivor.getByRole('button', { name: 'Join a world' }).press('Enter');
      await survivor.getByLabel('World server', { exact: true }).fill('ws://127.0.0.1:8788');
      await survivor
        .getByLabel('Survivor name')
        .fill(['Touch explorer', 'Alexandra Longname', 'Blair', 'Cameron'][i]);
      if (survivor === page) {
        await page.screenshot({ path: testInfo.outputPath('multiplayer-mobile-join.png') });
        await page.getByRole('button', { name: 'Join world', exact: true }).tap();
      } else await survivor.getByRole('button', { name: 'Join world', exact: true }).press('Enter');
      await expect(survivor.locator('#hud')).toBeVisible();
    }
    await expect(page.locator('#crew-button')).toHaveText('4/4');
    await expect(page.getByRole('button', { name: 'Crew and invite' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('multiplayer-mobile-world.png') });
    await page.getByRole('button', { name: 'Crew and invite' }).tap();
    await expect(page.locator('#crew-list li')).toHaveCount(4);
    await expect(page.locator('#crew-count')).toHaveText('4 / 4 survivors');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('multiplayer-mobile-crew.png') });
    await page.setViewportSize({ width: 915, height: 412 });
    await page.getByRole('button', { name: 'Copy invite link' }).tap();
    await page.screenshot({ path: testInfo.outputPath('multiplayer-mobile-landscape.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Find your crew' }).tap();
    await expect(page.locator('#island-map')).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('#island-map')
          .evaluate(
            (canvas) =>
              (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data[3],
          ),
      )
      .toBe(255);
    await page.screenshot({ path: testInfo.outputPath('multiplayer-mobile-map.png') });
    await page.getByRole('button', { name: 'Close panel' }).tap();
    await expect(page.getByRole('button', { name: 'Gather or place' })).toBeInViewport();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('mobile layout, touch move/look, menus and landscape fit the screen', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, 'Touch controls require the mobile project.');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter the frontier' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile-menu.png') });
  await startSolo(page);
  await expect(page.locator('#joystick')).toBeVisible();
  const before = await diagnostics(page),
    box = (await page.locator('#joystick').boundingBox())!;
  // CDP dispatches real touch input, exercising pointer capture and the virtual joystick.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 + 32, id: 1 }],
  });
  await page.waitForTimeout(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await diagnostics(page)).player.position.z).toBeGreaterThan(before.player.position.z + 1);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 200, y: 340, id: 2 }],
  });
  // A finger swipe spans time. An instantaneous CDP swipe can leave Chromium's
  // gesture recognizer suppressing the following tap even after touchEnd.
  await page.waitForTimeout(30);
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 200 + step * 10, y: 340 + (step * 25) / 6, id: 2 }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  expect(Math.abs((await diagnostics(page)).player.yaw)).toBeGreaterThan(0.1);
  await page.screenshot({ path: testInfo.outputPath('mobile-game.png') });
  await page.getByRole('button', { name: 'Pack and crafting', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'A life, in your pack.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile-pack.png') });
  await page.getByRole('button', { name: 'Close panel' }).tap();
  await page.setViewportSize({ width: 915, height: 412 });
  await page.screenshot({ path: testInfo.outputPath('mobile-landscape.png') });
  await expect(page.getByRole('button', { name: 'Gather or place' })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('developer controls are usable by touch in portrait and landscape', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startSolo(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.getByRole('button', { name: 'Developer tools' }).tap();
  await page.getByRole('button', { name: 'Dusk', exact: true }).tap();
  await expect
    .poll(async () => (await diagnostics(page)).environment.hours % 24)
    .toBeGreaterThanOrEqual(18);
  await page.getByRole('tab', { name: 'World variables' }).tap();
  await page.locator('[data-tuning="moonSize"]').fill('2');
  await page.getByRole('button', { name: 'Apply world variables' }).tap();
  await expect.poll(async () => (await diagnostics(page)).tuning.moonSize).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('mobile-developer-portrait.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 915, height: 412 });
  await page.getByRole('tab', { name: 'Quick tools' }).tap();
  await page.getByRole('checkbox', { name: 'Invincible', exact: true }).check();
  await page.getByRole('button', { name: 'Visit the coast', exact: true }).tap();
  await page.getByRole('button', { name: 'Close panel' }).tap();
  await expect(page.getByRole('button', { name: 'Hold to dive' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-coast.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('advanced rendering controls fit touch layouts and survive orientation changes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /GL_INVALID|WebGL:|cannot be cloned/.test(message.text()))
      errors.push(message.text());
  });
  await startSolo(page, 'mobile');
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();
  await page.getByRole('button', { name: 'Developer tools' }).tap();
  await page.getByRole('tab', { name: 'Rendering', exact: true }).tap();
  await page.getByText('Advanced rendering · off by default', { exact: true }).tap();
  for (const key of [
    'volumetricClouds',
    'volumetricFog',
    'screenSpaceReflections',
    'temporalUpscaling',
  ])
    await page.locator(`[data-graphics="${key}"]`).tap();
  await page.locator('[data-graphics="volumeSteps"]').fill('8');
  await page.getByRole('button', { name: 'Apply rendering', exact: true }).tap();
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.passes)
    .toContain('temporal resolve');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('advanced-mobile-controls.png') });
  await page.getByRole('button', { name: 'Close panel' }).tap();
  await page.setViewportSize({ width: 915, height: 412 });
  await page.screenshot({ path: testInfo.outputPath('advanced-mobile-landscape.png') });
  await expect(page.getByRole('button', { name: 'Gather or place' })).toBeInViewport();
  expect(errors).toEqual([]);
});
