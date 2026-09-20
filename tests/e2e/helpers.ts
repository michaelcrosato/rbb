import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { PlayerState, Building, Animal, LootBag } from '../../src/shared/state';
import type { Resource } from '../../src/shared/world';
import { RESOURCE_TYPES } from '../../src/shared/content';
import { structureSolids } from '../../src/shared/structure-geometry';
import { containsXZ } from '../../src/shared/spatial';

import type { Environment, Tuning, celestial } from '../../src/shared/environment';
import type { GraphicsSettings } from '../../src/client/render/settings';
import type { WorldRenderer } from '../../src/client/render/renderer';
import type { PublicPlayer } from '../../src/shared/protocol';
import type { TerrainState, TerrainHit, TerrainBrush } from '../../src/shared/terrain';
import type { WorldSite } from '../../src/shared/site-generation';
import type { SiteState } from '../../src/shared/state';

export interface Diagnostics {
  bags: LootBag[];
  sites: WorldSite[];
  siteStates: Record<string, SiteState>;
  terrain: TerrainState;
  terrainMesh: { revision: number; samples: number; editedChunks: number; triangles: number };
  terrainTool: {
    mode: string | null;
    level: number;
    hit: TerrainHit | null;
    developer: TerrainBrush | null;
  };
  environment: Environment;
  tuning: Tuning;
  celestial: ReturnType<typeof celestial>;
  animals: Animal[];
  sandbox: boolean;
  devAllowed: boolean;
  graphics: GraphicsSettings;
  effectiveGraphics: GraphicsSettings;
  pipeline: WorldRenderer['pipeline'];
  player: PlayerState;
  players: PublicPlayer[];
  remoteSurvivors: WorldRenderer['remoteSurvivors'];
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
    quality: string;
    fps: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    frameMs: number;
    pixelRatio: number;
    gpuMs: number | null;
    gpuP95Ms: number | null;
  };
}
export const diagnostics = (page: Page): Promise<Diagnostics> =>
  page.evaluate(() =>
    (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics(),
  );

export async function waitForMovementStop(page: Page): Promise<void> {
  // Native keyup can finish before the next client frame sends its idle command.
  // Observe the simulation/server acknowledgement before sampling a final position.
  await page.waitForFunction(
    () => {
      const input = (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics()
        .player.input;
      return input.forward === 0 && input.strafe === 0;
    },
    undefined,
    { timeout: 8000 },
  );
}

/** Native touch gestures only; diagnostics supplies read-only camera feedback. */
export async function touchAimAt(page: Page, x: number, y: number, z: number): Promise<void> {
  const { player, look } = await diagnostics(page);
  const dx = x - player.position.x,
    dz = z - player.position.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(y - player.position.y - 1.65, Math.hypot(dx, dz));
  const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
  let remainingX = -delta / (0.0022 * 1.8),
    remainingY = -(pitch - look.pitch) / (0.0022 * 1.8);
  const viewport = page.viewportSize()!;
  const origin = { x: viewport.width * 0.67, y: viewport.height * 0.45 };
  const cdp = await page.context().newCDPSession(page);
  try {
    while (Math.abs(remainingX) > 0.1 || Math.abs(remainingY) > 0.1) {
      const stepX = Math.max(-60, Math.min(60, remainingX));
      const stepY = Math.max(-90, Math.min(90, remainingY));
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...origin, id: 1 }],
      });
      for (let step = 1; step <= 4; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: origin.x + (stepX * step) / 4, y: origin.y + (stepY * step) / 4, id: 1 },
          ],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      remainingX -= stepX;
      remainingY -= stepY;
    }
    await expect
      .poll(async () => Math.abs((await diagnostics(page)).look.pitch - pitch))
      .toBeLessThan(0.03);
  } finally {
    await cdp.detach();
  }
}

export async function startSolo(
  page: Page,
  quality: 'auto' | 'mobile' = 'auto',
  activation: 'mouse' | 'keyboard' = 'mouse',
): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter the frontier' })).toBeVisible();
  if (quality !== 'auto') {
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    if (activation === 'keyboard') await settings.press('Enter');
    else await settings.click();
    await page.locator('#quality').selectOption(quality);
    // Exercise the full scene/effect pipeline at a bounded pixel cost on GPU-free runners.
    // Hardware-resolution performance and visual evidence come from scripts/benchmark.ts.
    const effects = page.getByText('Rendering effects', { exact: true });
    if (activation === 'keyboard') await effects.press('Enter');
    else await effects.click();
    await page.locator('[data-graphics="resolutionScale"]').fill('0.5');
    const apply = page.getByRole('button', { name: 'Apply settings' });
    if (activation === 'keyboard') await apply.press('Enter');
    else await apply.click();
  }
  const enter = page.getByRole('button', { name: 'Enter the frontier' });
  if (activation === 'keyboard') await enter.press('Enter');
  else await enter.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(1);
}

export async function aimAt(page: Page, x: number, y: number, z: number): Promise<void> {
  // All navigation uses real mouse input. Diagnostics returns copies and never edits game state.
  await page.mouse.move(600, 300);
  let mouseX = 600,
    mouseY = 300;
  await expect
    .poll(
      async () => {
        const pointerLocked = await page.evaluate(() => document.pointerLockElement !== null);
        if (!pointerLocked && (mouseX !== 600 || mouseY !== 300)) {
          await page.mouse.move(600, 300);
          mouseX = 600;
          mouseY = 300;
        }
        const { player, look } = await diagnostics(page);
        const dx = x - player.position.x,
          dz = z - player.position.z;
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.max(
          -1.45,
          Math.min(1.45, Math.atan2(y - player.position.y - 1.65, Math.hypot(dx, dz))),
        );
        const yawError = (value: number) =>
          Math.abs(Math.atan2(Math.sin(yaw - value), Math.cos(yaw - value)));
        const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
        if (Math.max(Math.abs(delta), Math.abs(pitch - look.pitch)) < 0.01)
          return Math.max(yawError(player.yaw), Math.abs(pitch - player.pitch));
        const remainingX = -delta / 0.0022,
          remainingY = -(pitch - look.pitch) / 0.0022;
        // Capture may arrive between strokes. Re-observe both axes instead of
        // assuming each native event was applied. Right-drag also avoids using
        // the equipped item if capture arrives during a fallback drag gesture.
        if (!pointerLocked) await page.mouse.down({ button: 'right' });
        mouseX += pointerLocked ? remainingX : Math.max(-350, Math.min(350, remainingX));
        mouseY += pointerLocked ? remainingY : Math.max(-230, Math.min(230, remainingY));
        await page.mouse.move(mouseX, mouseY);
        if (!pointerLocked) await page.mouse.up({ button: 'right' });
        return Infinity;
      },
      { message: 'Camera reaches the intended heading and pitch', intervals: [0] },
    )
    .toBeLessThan(0.02);
}

export async function walkTo(page: Page, x: number, z: number, stop = 0.7): Promise<void> {
  // Stop after observed movement; wall-clock taps vary with render and driver latency.
  const deadline = Date.now() + 45000;
  const route: { x: number; z: number; distance: number; stride: number; correcting: boolean }[] =
    [];
  let origin: { x: number; z: number } | undefined;
  while (Date.now() < deadline) {
    const d = await diagnostics(page);
    const start = (origin ??= { ...d.player.position });
    const distance = Math.hypot(x - d.player.position.x, z - d.player.position.z);
    if (distance < stop) return;
    const previous = route.at(-1);
    const lastStep = previous
      ? Math.hypot(d.player.position.x - previous.x, d.player.position.z - previous.z)
      : 0;
    // Use the same short pulse near the goal, so its observed travel includes the
    // native key-release latency. Larger pulses would invalidate that estimate.
    const stride = distance < Math.max(2, lastStep * 2) ? 0.1 : Math.min(2, (distance - stop) / 2);
    // Once a short pulse is measured, turn before it would cross the goal. End
    // one pulse from the goal, then approach head-on; waiting for an overshoot
    // first can walk off a narrow upper landing before there is room to recover.
    const correcting = previous?.stride === 0.1 && !previous.correcting && distance < lastStep;
    route.push({ x: d.player.position.x, z: d.player.position.z, distance, stride, correcting });
    let heading = Math.atan2(d.player.position.x - x, d.player.position.z - z);
    if (correcting) {
      const turn = Math.acos(Math.min(1, distance / (2 * lastStep)));
      // Both chords approach the same target. On structures, use read-only
      // collision geometry to keep the endpoint supported, then favor the
      // approach route. A blind sideways correction can step off the landing.
      const solids = d.buildings.flatMap(structureSolids);
      const supported = (x: number, z: number, tolerance: number) =>
        solids.some(
          (s) =>
            Math.abs(s.y + s.height / 2 - d.player.position.y) < tolerance &&
            containsXZ(s, x, z, 0.33),
        );
      const onStructure = supported(d.player.position.x, d.player.position.z, 0.05);
      const candidates = [heading + turn, heading - turn].map((angle) => {
        const px = d.player.position.x - Math.sin(angle) * lastStep;
        const pz = d.player.position.z - Math.cos(angle) * lastStep;
        return {
          heading: angle,
          supported: !onStructure || supported(px, pz, 0.65),
          distance: Math.hypot(px - start.x, pz - start.z),
        };
      });
      candidates.sort(
        (a, b) => Number(b.supported) - Number(a.supported) || a.distance - b.distance,
      );
      heading = candidates[0].heading;
    }
    if (
      Math.abs(Math.atan2(Math.sin(heading - d.look.yaw), Math.cos(heading - d.look.yaw))) > 0.025
    )
      await aimAt(
        page,
        d.player.position.x - Math.sin(heading) * 5,
        d.player.position.y + 1.65,
        d.player.position.z - Math.cos(heading) * 5,
      );
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
        stride,
      },
      { timeout: 8000 },
    );
    try {
      // Install the observer before keydown and release immediately when it resolves,
      // even if the keydown acknowledgement is still waiting for a slow render frame.
      await Promise.all([page.keyboard.down('KeyW'), moved.then(() => page.keyboard.up('KeyW'))]);
      await waitForMovementStop(page);
    } catch (error) {
      await page.keyboard.up('KeyW');
      throw error;
    }
  }
  const d = await diagnostics(page);
  expect(
    Math.hypot(x - d.player.position.x, z - d.player.position.z),
    `AI navigator reached the destination using keyboard input: ${JSON.stringify({ target: { x, z }, route: route.slice(-6) })}`,
  ).toBeLessThan(stop);
}

export async function gather(page: Page, id: string, hits: number): Promise<void> {
  const { resources, player } = await diagnostics(page);
  const r = resources.find((r) => r.id === id)!;
  const dist = Math.hypot(player.position.x - r.x, player.position.z - r.z);
  // Any side within reach is valid. A fixed approach point can end up behind a
  // solid resource after a delayed key release, making navigation walk into it.
  if (dist > 3) await walkTo(page, r.x, r.z, 2.5);
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
