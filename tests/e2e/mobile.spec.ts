import { test, expect } from '@playwright/test';
import { diagnostics, startSolo } from './helpers';

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
