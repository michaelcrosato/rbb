import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startSolo, diagnostics } from './helpers';
import { ADVANCED_FEATURES } from '../../src/client/render/settings';

async function rendering(page: Page): Promise<void> {
  if (!(await page.getByRole('tab', { name: 'Rendering', exact: true }).isVisible()))
    await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Rendering', exact: true }).click();
  await page.getByText('Advanced rendering · off by default', { exact: true }).click();
}
async function apply(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply rendering', exact: true }).click();
}

test('advanced rendering composes, resets history and preserves Low progression', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/.test(message.text())
    )
      errors.push(message.text());
  });
  await startSolo(page, 'mobile');
  const original = await diagnostics(page);
  for (const key of ADVANCED_FEATURES) expect(original.graphics[key]).toBe(false);
  expect(original.pipeline.sharedBuffer).toBe(false);
  await rendering(page);
  for (const key of ADVANCED_FEATURES) await page.locator(`[data-graphics="${key}"]`).check();
  for (const key of ['bloom', 'ambientOcclusion', 'sunShafts', 'lensFlare', 'planarReflections'])
    await page.locator(`[data-graphics="${key}"]`).check();
  // Exercise the same shaders at bounded work on software-rendered CI.
  await page.locator('[data-graphics="volumeSteps"]').fill('8');
  await page.locator('[data-graphics="effectResolution"]').fill('0.25');
  await page.locator('[data-graphics="shadowCascades"]').fill('2');
  await page.locator('[data-graphics="shadowDistance"]').fill('160');
  await apply(page);
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.probes?.ready, { timeout: 30000 })
    .toBeGreaterThan(0);
  const enabled = await diagnostics(page);
  for (const key of ADVANCED_FEATURES) expect(enabled.effectiveGraphics[key]).toBe(true);
  expect(enabled.pipeline.sharedBuffer).toBe(true);
  expect(enabled.pipeline.passes).toContain('temporal resolve');
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: testInfo.outputPath('advanced-stack.png') });
  const z = (await diagnostics(page)).player.position.z;
  await page.keyboard.down('KeyS');
  await expect
    .poll(async () => (await diagnostics(page)).player.position.z)
    .toBeGreaterThan(z + 0.3);
  await page.keyboard.up('KeyS');
  await page.keyboard.press('F2');
  await page.getByRole('tab', { name: 'Quick tools', exact: true }).click();
  await page.getByRole('button', { name: 'Visit the coast', exact: true }).click();
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.historyReset)
    .toMatch(/camera cut|water boundary/);
  await page.getByRole('button', { name: 'Return to Haven', exact: true }).click();
  await page.getByRole('button', { name: 'Midnight', exact: true }).click();
  await page.getByRole('button', { name: 'Full moon', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).celestial.moonlight).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: testInfo.outputPath('advanced-moonlight.png') });
  const beforeLow = await diagnostics(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#quality').selectOption('low');
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect.poll(async () => (await diagnostics(page)).pipeline.sharedBuffer).toBe(false);
  const low = await diagnostics(page);
  for (const key of ADVANCED_FEATURES) {
    expect(low.graphics[key]).toBe(true);
    expect(low.effectiveGraphics[key]).toBe(false);
  }
  expect(low.pipeline.probes).toBeNull();
  expect(low.pipeline.passes).toEqual([]);
  expect(low.player.inventory).toEqual(beforeLow.player.inventory);
  expect(low.player.milestones).toEqual(beforeLow.player.milestones);
  expect(low.animals.map((animal) => [animal.id, animal.species])).toEqual(
    original.animals.map((animal) => [animal.id, animal.species]),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#quality').selectOption('mobile');
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect.poll(async () => (await diagnostics(page)).pipeline.sharedBuffer).toBe(true);
  await rendering(page);
  for (const key of ADVANCED_FEATURES) await page.locator(`[data-graphics="${key}"]`).uncheck();
  for (const key of ['bloom', 'ambientOcclusion', 'sunShafts', 'lensFlare', 'planarReflections'])
    await page.locator(`[data-graphics="${key}"]`).uncheck();
  await apply(page);
  await expect.poll(async () => (await diagnostics(page)).pipeline.estimatedTargetMiB).toBe(0);
  // Replacement worlds must not retain old light-probe textures or material hooks.
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Continue expedition' }).click();
  expect((await diagnostics(page)).pipeline.sharedBuffer).toBe(false);
  expect(errors).toEqual([]);
});

test('distant GPU buffers reload when the survivor returns to their region', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/.test(message.text())
    )
      errors.push(message.text());
  });
  await startSolo(page, 'mobile');
  await rendering(page);
  await page.locator('[data-graphics="chunkStreaming"]').check();
  await page.locator('[data-graphics="streamingDistance"]').fill('128');
  await apply(page);
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.visibility.evictions, { timeout: 25000 })
    .toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await page.locator('#dev-x').fill('0');
  await page.locator('#dev-z').fill('280');
  await page.getByRole('button', { name: 'Teleport', exact: true }).click();
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.visibility.reloads)
    .toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Quick tools', exact: true }).click();
  await page.getByRole('button', { name: 'Return to Haven', exact: true }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: testInfo.outputPath('streamed-return.png') });
  expect(errors).toEqual([]);
});

test('shared buffer views and repeated temporal/volume toggles release render targets', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/.test(message.text())
    )
      errors.push(message.text());
  });
  await startSolo(page, 'mobile');
  await rendering(page);
  await expect.poll(async () => (await diagnostics(page)).renderer.textures).toBeGreaterThan(0);
  const baseline = (await diagnostics(page)).renderer.textures;
  for (let cycle = 0; cycle < 2; cycle++) {
    if (cycle) await rendering(page);
    for (const key of ['temporalUpscaling', 'volumetricClouds', 'volumetricFog'])
      await page.locator(`[data-graphics="${key}"]`).check();
    await page.locator('[data-graphics="volumeSteps"]').fill('8');
    await page.locator('[data-graphics="bufferView"]').selectOption(cycle ? 'velocity' : 'normals');
    await apply(page);
    await expect
      .poll(async () => (await diagnostics(page)).renderer.textures)
      .toBeGreaterThan(baseline);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.screenshot({ path: testInfo.outputPath(`buffers-${cycle}.png`) });
    await rendering(page);
    await page.getByRole('button', { name: 'Reset rendering defaults', exact: true }).click();
    await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
    await apply(page);
    await expect.poll(async () => (await diagnostics(page)).renderer.textures).toBe(baseline);
  }
  expect(errors).toEqual([]);
});

test('graphics context restoration rebuilds the pipeline and keeps the expedition', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/.test(message.text())
    )
      errors.push(message.text());
  });
  await startSolo(page, 'mobile');
  const before = await diagnostics(page);
  await rendering(page);
  for (const key of [
    'temporalUpscaling',
    'volumetricClouds',
    'globalIllumination',
    'cascadedShadows',
    'gpuTiming',
    'planarReflections',
    'bloom',
    'ambientOcclusion',
    'sunShafts',
    'lensFlare',
  ])
    await page.locator(`[data-graphics="${key}"]`).check();
  await page.locator('[data-graphics="volumeSteps"]').fill('8');
  await page.locator('[data-graphics="shadowCascades"]').fill('2');
  await apply(page);
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.probes?.ready)
    .toBeGreaterThan(0);
  // Standard browser fault-injection API, without editing game state or diagnostics.
  await page.evaluate(() => {
    const extension = document
      .querySelector('canvas')!
      .getContext('webgl2')!
      .getExtension('WEBGL_lose_context')!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 300);
  });
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.historyReset)
    .toBe('graphics context restored');
  await expect(page.locator('#fatal')).toBeHidden();
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.probes?.ready, { timeout: 20000 })
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Return to the wild', exact: true }).click();
  const after = await diagnostics(page);
  expect(after.player.inventory).toEqual(before.player.inventory);
  expect(after.sandbox).toBe(false);
  expect(after.pipeline.sharedBuffer).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('context-restored.png') });
  // Replacing the world after restoration must not dispose stale GL handles.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save & return to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Continue expedition', exact: true }).click();
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.probes?.ready)
    .toBeGreaterThan(0);
  expect((await diagnostics(page)).player.inventory).toEqual(before.player.inventory);
  expect(errors).toEqual([]);
});

test('normal multiplayer servers permit local graphics controls without sandbox mutations', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /GL_INVALID|WebGL:|cannot be cloned/.test(message.text()))
      errors.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#quality').selectOption('mobile');
  await page.getByText('Rendering effects', { exact: true }).click();
  await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
  await page.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await page.getByRole('button', { name: 'Join a world', exact: true }).click();
  await page.locator('#server-url').fill('ws://127.0.0.1:8788');
  await page.getByRole('button', { name: 'Join world', exact: true }).click();
  await expect(page.locator('#hud')).toBeVisible();
  // Open while startup may still be granting pointer capture.
  await page.keyboard.press('F2');
  await expect(
    page.getByText(
      'This server has developer tools disabled. Rendering controls are available on your device.',
    ),
  ).toBeVisible();
  await rendering(page);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  const before = await diagnostics(page);
  expect(before.devAllowed).toBe(false);
  await page.locator('[data-graphics="temporalUpscaling"]').check();
  await apply(page);
  await expect
    .poll(async () => (await diagnostics(page)).pipeline.passes)
    .toContain('temporal resolve');
  const after = await diagnostics(page);
  expect(after.sandbox).toBe(false);
  expect(after.player.inventory).toEqual(before.player.inventory);
  expect(after.player.milestones).toEqual(before.player.milestones);
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(after.tick);
  expect(errors).toEqual([]);
});
