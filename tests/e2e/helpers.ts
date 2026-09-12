import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerState, Building } from '../../src/shared/state';
import type { Resource } from '../../src/shared/world';
import { RESOURCE_TYPES } from '../../src/shared/content';

export interface Diagnostics {
  player: PlayerState;
  look: { yaw: number; pitch: number };
  mutations: Record<string, { health: number; respawnAt: number }>;
  tick: number;
  panel: string | null;
  mode: string;
  resources: Resource[];
  target?: string;
  buildings: Building[];
  build: Building;
  renderer: {
    fps: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    pixelRatio: number;
  };
}
export const diagnostics = (page: Page): Promise<Diagnostics> =>
  page.evaluate(() =>
    (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics(),
  );

export async function startSolo(page: Page, quality: 'auto' | 'mobile' = 'auto'): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter the frontier' })).toBeVisible();
  if (quality !== 'auto') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#quality').selectOption(quality);
    await page.getByRole('button', { name: 'Apply settings' }).click();
  }
  await page.getByRole('button', { name: 'Enter the frontier' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(1);
}

export async function aimAt(page: Page, x: number, y: number, z: number): Promise<void> {
  // All navigation uses real mouse input. Diagnostics returns copies and never edits game state.
  await page.mouse.move(600, 300);
  const { player, look } = await diagnostics(page);
  const dx = x - player.position.x,
    dz = z - player.position.z;
  const yaw = Math.atan2(-dx, -dz),
    pitch = Math.atan2(y - player.position.y - 1.65, Math.hypot(dx, dz));
  const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
  const pointerLocked = await page.evaluate(() => document.pointerLockElement !== null);
  let remainingX = -delta / 0.0022,
    remainingY = -(pitch - look.pitch) / 0.0022;
  if (pointerLocked) {
    await page.mouse.move(600 + remainingX, 300 + remainingY);
  } else {
    // Headless Chromium may decline pointer capture. Exercise the same drag control
    // available to players, keeping each stroke within the canvas.
    while (Math.abs(remainingX) > 0.1 || Math.abs(remainingY) > 0.1) {
      const stepX = Math.max(-350, Math.min(350, remainingX)),
        stepY = Math.max(-230, Math.min(230, remainingY));
      await page.mouse.move(600, 300);
      await page.mouse.down();
      await page.mouse.move(600 + stepX, 300 + stepY);
      await page.mouse.up();
      remainingX -= stepX;
      remainingY -= stepY;
    }
  }
  await expect
    .poll(
      async () => {
        const d = await diagnostics(page);
        return Math.abs(Math.atan2(Math.sin(yaw - d.player.yaw), Math.cos(yaw - d.player.yaw)));
      },
      { message: `Camera reaches the intended heading (pointer locked: ${pointerLocked})` },
    )
    .toBeLessThan(0.02);
}

export async function walkTo(page: Page, x: number, z: number, stop = 0.7): Promise<void> {
  // Stop after observed movement; wall-clock taps vary with render and driver latency.
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const d = await diagnostics(page);
    const distance = Math.hypot(x - d.player.position.x, z - d.player.position.z);
    if (distance < stop) return;
    const heading = Math.atan2(d.player.position.x - x, d.player.position.z - z);
    if (
      Math.abs(Math.atan2(Math.sin(heading - d.look.yaw), Math.cos(heading - d.look.yaw))) > 0.025
    )
      await aimAt(page, x, d.player.position.y + 1.65, z);
    const moved = page.waitForFunction(
      ({ x, z, stop, startX, startZ, stride }) => {
        const p = (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics()
          .player.position;
        return (
          Math.hypot(x - p.x, z - p.z) < stop || Math.hypot(p.x - startX, p.z - startZ) >= stride
        );
      },
      {
        x,
        z,
        stop,
        startX: d.player.position.x,
        startZ: d.player.position.z,
        stride: Math.min(2, Math.max(0.1, (distance - stop) / 2)),
      },
      { timeout: 8000 },
    );
    try {
      // Install the observer before keydown and release immediately when it resolves,
      // even if the keydown acknowledgement is still waiting for a slow render frame.
      await Promise.all([page.keyboard.down('KeyW'), moved.then(() => page.keyboard.up('KeyW'))]);
    } catch (error) {
      await page.keyboard.up('KeyW');
      throw error;
    }
  }
  const d = await diagnostics(page);
  expect(
    Math.hypot(x - d.player.position.x, z - d.player.position.z),
    'AI navigator reached the destination using keyboard input',
  ).toBeLessThan(stop);
}

export async function gather(page: Page, id: string, hits: number): Promise<void> {
  const { resources, player } = await diagnostics(page);
  const r = resources.find((r) => r.id === id)!;
  const dist = Math.hypot(player.position.x - r.x, player.position.z - r.z);
  if (dist > 3)
    await walkTo(
      page,
      r.x + ((player.position.x - r.x) / dist) * 2.5,
      r.z + ((player.position.z - r.z) / dist) * 2.5,
    );
  await aimAt(page, r.x, r.y + (r.kind === 'tree' ? 1.5 : r.kind === 'rock' ? 0.9 : 0.5), r.z);
  await expect.poll(async () => (await diagnostics(page)).target).toBe(id);
  for (let i = 0; i < hits; i++) {
    await expect.poll(async () => (await diagnostics(page)).player.cooldown).toBe(0);
    const before = (await diagnostics(page)).mutations[id]?.health ?? RESOURCE_TYPES[r.kind].health;
    await page.keyboard.press('KeyE');
    await expect
      .poll(async () => (await diagnostics(page)).mutations[id]?.health)
      .toBeLessThan(before);
  }
}
