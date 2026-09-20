import { test, expect } from './fixtures';
import { WEATHER } from '../../src/shared/environment';
import type { WeatherKind } from '../../src/shared/environment';
import { diagnostics, startSolo } from './helpers';

test('developer tools preview sky and weather, change wildlife and restore a checkpoint', async ({
  page,
}, testInfo) => {
  await startSolo(page, 'mobile');
  const original = await diagnostics(page);
  await page.keyboard.press('F2');
  await expect(page.getByRole('heading', { name: 'Developer tools' })).toBeVisible();
  await page.getByRole('button', { name: 'Freeze sky', exact: true }).click();
  await page.getByRole('button', { name: 'Midnight', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.sunlight).toBe(0);
  expect((await diagnostics(page)).celestial.stars).toBeGreaterThan(0.5);
  await page.getByRole('button', { name: 'Full moon', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.moonlight).toBeGreaterThan(0.1);
  await page.screenshot({ path: testInfo.outputPath('full-moon.png') });
  await page.getByRole('button', { name: 'New moon', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.moonlight).toBe(0);
  await page.getByRole('button', { name: 'Dawn', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.sun.x).toBeGreaterThan(0.99);
  await page.screenshot({ path: testInfo.outputPath('dawn.png') });
  await page.getByRole('button', { name: 'Dusk', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.sun.x).toBeLessThan(-0.99);
  await page.getByRole('button', { name: 'Noon', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Instant weather changes' }).check();
  for (const weather of ['fog', 'rain', 'storm', 'snow', 'clear']) {
    await page.locator('#dev-weather').selectOption(weather);
    await expect.poll(async () => (await diagnostics(page)).environment.weather).toBe(weather);
    await expect
      .poll(async () => (await diagnostics(page)).celestial.weather)
      .toEqual(WEATHER[weather as WeatherKind]);
    await page.screenshot({ path: testInfo.outputPath(`${weather}.png`) });
  }
  await page.getByRole('checkbox', { name: 'Invincible', exact: true }).check();
  await page.getByRole('button', { name: 'Replace pack with test kit' }).click();
  await expect.poll(async () => (await diagnostics(page)).player.inventory.hatchet).toBe(1);
  await page.locator('#dev-species').selectOption('deer');
  await page.getByRole('button', { name: 'Spawn nearby' }).click();
  await expect
    .poll(async () => (await diagnostics(page)).animals.length)
    .toBe(original.animals.length + 1);
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const tick = (await diagnostics(page)).tick;
  await page.getByRole('button', { name: 'Step one second', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).tick).toBe(tick + 30);
  await page.getByRole('button', { name: 'Restore checkpoint', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).sandbox).toBe(false);
  const restored = await diagnostics(page);
  expect(restored.player.inventory).toEqual(original.player.inventory);
  expect(restored.player.dev.invincible).toBe(false);
  expect(restored.animals.length).toBe(original.animals.length);
  expect(restored.tuning.timeScale).toBe(1);
});

test('advanced variations validate, persist, and survive reload; renderer switches release resources', async ({
  page,
}, testInfo) => {
  await startSolo(page, 'mobile');
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'World variables' }).click();
  await page.locator('[data-tuning="gravity"]').fill('0');
  await page.getByRole('button', { name: 'Apply world variables' }).click();
  expect((await diagnostics(page)).tuning.gravity).toBe(1);
  await page.locator('[data-tuning="gravity"]').fill('0.5');
  await page.locator('[data-tuning="moonSize"]').fill('2');
  await page.locator('[data-tuning="weatherAutomatic"]').uncheck();
  await page.getByRole('button', { name: 'Apply world variables' }).click();
  await expect.poll(async () => (await diagnostics(page)).tuning.gravity).toBe(0.5);
  await page.locator('#dev-preset-name').fill('Low gravity');
  await page.getByRole('button', { name: 'Save preset', exact: true }).click();
  await page.getByRole('button', { name: 'Reset world defaults' }).click();
  await page.locator('#dev-preset-name').fill('Low gravity');
  await page.getByRole('button', { name: 'Load preset', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).tuning.moonSize).toBe(2);
  await page.getByRole('tab', { name: 'Quick tools' }).click();
  await page.getByRole('button', { name: 'Visit the coast' }).click();
  await page.getByRole('button', { name: 'Face sun', exact: true }).click();
  await page.getByRole('tab', { name: 'Rendering', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).renderer.textures).toBeGreaterThan(0);
  const baselineTextures = (await diagnostics(page)).renderer.textures;
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('checkbox', { name: 'Bloom', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Ambient occlusion', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Sun shafts', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Lens flare', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Reflections of the coast', exact: true }).check();
    await page.getByRole('button', { name: 'Apply rendering', exact: true }).click();
    await expect.poll(async () => (await diagnostics(page)).graphics.ambientOcclusion).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`post-effects-${cycle}.png`) });
    await page.getByRole('button', { name: 'Reset rendering defaults' }).click();
    await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
    await page.getByRole('button', { name: 'Apply rendering', exact: true }).click();
    await expect.poll(async () => (await diagnostics(page)).graphics.ambientOcclusion).toBe(false);
    await expect
      .poll(async () => (await diagnostics(page)).renderer.textures)
      .toBe(baselineTextures);
  }
  await page.getByRole('checkbox', { name: 'Collision bounds' }).check();
  await page.getByRole('button', { name: 'Apply rendering', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('collision-inspector.png') });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.keyboard.press('Escape'); // Saves via the actual pause flow.
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).tuning.gravity).toBe(0.5);
  expect((await diagnostics(page)).tuning.weatherAutomatic).toBe(false);
  expect((await diagnostics(page)).graphics.collisionDebug).toBe(true);
});

test('Low preserves survival and progression while suppressing enhanced effects', async ({
  page,
}, testInfo) => {
  await startSolo(page, 'mobile');
  const original = await diagnostics(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#quality').selectOption('low');
  await page.getByText('Rendering effects', { exact: true }).click();
  await page.getByRole('button', { name: 'Enable enhanced effects' }).click();
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect.poll(async () => (await diagnostics(page)).renderer.quality).toBe('low');
  const low = await diagnostics(page);
  expect(low.graphics.bloom).toBe(true);
  expect(low.effectiveGraphics.bloom).toBe(false);
  expect(low.effectiveGraphics.planarReflections).toBe(false);
  expect(low.renderer.pixelRatio).toBeLessThanOrEqual(0.8);
  expect(low.sandbox).toBe(false);
  expect(low.tuning).toEqual(original.tuning);
  expect(low.player.inventory).toEqual(original.player.inventory);
  expect(low.player.milestones).toEqual(original.player.milestones);
  expect(low.animals.map((a) => [a.id, a.species])).toEqual(
    original.animals.map((a) => [a.id, a.species]),
  );
  await page.screenshot({ path: testInfo.outputPath('low-world.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#quality').selectOption('balanced');
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect
    .poll(async () => (await diagnostics(page)).effectiveGraphics.planarReflections)
    .toBe(true);
  expect((await diagnostics(page)).sandbox).toBe(false);
});
