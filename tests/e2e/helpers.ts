import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerState, Building } from '../../src/shared/state';
import type { Resource } from '../../src/shared/world';

export interface Diagnostics {
  player: PlayerState;
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

export async function startSolo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter the frontier' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter the frontier' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(1);
}

export async function aimAt(page: Page, x: number, y: number, z: number): Promise<void> {
  // All navigation uses real mouse input. Diagnostics returns copies and never edits game state.
  await page.mouse.move(600, 300);
  await page.waitForTimeout(90);
  const { player } = await diagnostics(page);
  const dx = x - player.position.x,
    dz = z - player.position.z;
  const yaw = Math.atan2(-dx, -dz),
    pitch = Math.atan2(y - player.position.y - 1.65, Math.hypot(dx, dz));
  const delta = Math.atan2(Math.sin(yaw - player.yaw), Math.cos(yaw - player.yaw));
  await page.mouse.move(600 - delta / 0.0022, 300 - (pitch - player.pitch) / 0.0022);
  await page.waitForTimeout(110);
}

export async function walkTo(page: Page, x: number, z: number, stop = 0.7): Promise<void> {
  const d = await diagnostics(page);
  await aimAt(page, x, d.player.position.y + 1.65, z);
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(
        async () => {
          const { player } = await diagnostics(page);
          return Math.hypot(x - player.position.x, z - player.position.z);
        },
        { timeout: 12000, intervals: [30, 40, 50] },
      )
      .toBeLessThan(stop);
  } finally {
    await page.keyboard.up('KeyW');
  }
  await page.waitForTimeout(100);
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
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(610);
  }
}
