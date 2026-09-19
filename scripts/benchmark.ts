import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { buildCandidate } from '../src/shared/building';
import { encodeSave } from '../src/shared/save';
import { Simulation } from '../src/shared/simulation';
import { createBuilding, createState } from '../src/shared/state';
import { generateWorld, terrainHeight } from '../src/shared/world';
import { setWeather } from '../src/shared/environment';
import type { Diagnostics } from '../tests/e2e/helpers';

// A repeatable GPU workload. Fixtures enter through the same validated save-import UI as user saves.
// This measures the current machine; mobile viewport emulation is never a phone benchmark.
const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = resolve('.artifacts/benchmark');
await mkdir(output, { recursive: true });
const world = generateWorld('quiet-frontier');
const sim = new Simulation(world, createState(world));
const player = sim.addPlayer('local', 'Benchmark');
player.position = { x: 0, z: 115, y: terrainHeight(0, 115, world.hash) };
player.pitch = -0.12;
const fixturePath = resolve(output, 'camp.json');
for (let i = 0; i < 50; i++) {
  const x = ((i % 10) - 4.5) * 4,
    z = 70 + Math.floor(i / 10) * 4;
  const b = buildCandidate(sim.state, world, 'foundation', x, z, 0);
  sim.state.buildings.push(createBuilding(b, `b${sim.state.nextId++}`, player.id));
  const kind = i < 25 ? 'wall' : i < 40 ? 'campfire' : 'bedroll';
  const extra = buildCandidate(sim.state, world, kind, b.x, b.z, 0);
  sim.state.buildings.push(createBuilding(extra, `b${sim.state.nextId++}`, player.id));
}
for (const r of world.resources)
  if (sim.state.buildings.some((b) => Math.hypot(b.x - r.x, b.z - r.z) < 3))
    sim.state.resources[r.id] = { health: 0, respawnAt: 100000 };
await writeFile(fixturePath, encodeSave(sim.state, player.id));
const stormPath = resolve(output, 'storm-coast.json');
setWeather(sim.state.environment, 'storm', 0);
sim.state.environment.wetness = 1;
player.position = { x: 0, z: -200, y: Math.max(-1.2, terrainHeight(0, -200, world.hash)) };
player.yaw = Math.PI;
await writeFile(stormPath, encodeSave(sim.state, player.id));
const software = process.argv.includes('--software');
const browser = await chromium.launch({
  ...(software ? {} : { channel: 'chrome' }),
  args: software
    ? ['--enable-webgl', '--enable-unsafe-swiftshader']
    : ['--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
const report: Record<string, unknown> = {
  recordedAt: new Date().toISOString(),
  note: 'Current-machine browser measurement. Mobile viewport is emulation, not physical S25 evidence.',
  scenes: [],
};
try {
  for (const scene of [
    { name: 'balanced-camp', quality: 'balanced', fixture: fixturePath, enhanced: false },
    { name: 'mobile-camp', quality: 'mobile', fixture: fixturePath, enhanced: false },
    { name: 'low-camp', quality: 'low', fixture: fixturePath, enhanced: false },
    { name: 'enhanced-camp', quality: 'high', fixture: fixturePath, enhanced: true },
    { name: 'storm-coast', quality: 'high', fixture: stormPath, enhanced: true },
  ] as const) {
    const { quality } = scene;
    const context = await browser.newContext(
      quality === 'mobile'
        ? {
            viewport: { width: 915, height: 412 },
            hasTouch: true,
            isMobile: true,
            deviceScaleFactor: 2,
          }
        : { viewport: { width: 1920, height: 1080 } },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#quality').selectOption(quality);
    if (scene.enhanced) {
      await page.getByText('Rendering effects', { exact: true }).click();
      await page.getByRole('button', { name: 'Enable enhanced effects' }).click();
    }
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await page.getByRole('button', { name: 'Field guide' }).click();
    await page.locator('#import-file').setInputFiles(scene.fixture);
    await page.waitForTimeout(5000);
    const samples: Diagnostics['renderer'][] = [];
    for (let i = 0; i < 12; i++) {
      samples.push(
        await page.evaluate(
          () =>
            (window as unknown as { rbbDiagnostics: () => Diagnostics }).rbbDiagnostics().renderer,
        ),
      );
      await page.waitForTimeout(500);
    }
    const gpu = await page.evaluate(() => {
      const gl = document.querySelector('canvas')!.getContext('webgl2')!;
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
    });
    const fps = samples.map((s) => s.fps).sort((a, b) => a - b);
    (report.scenes as unknown[]).push({
      quality,
      name: scene.name,
      enhanced: scene.enhanced,
      viewport: page.viewportSize(),
      buildings: 100,
      gpu,
      medianFps: fps[Math.floor(fps.length / 2)],
      lowestOneSecondFps: fps[0],
      maxDrawCalls: Math.max(...samples.map((s) => s.drawCalls)),
      maxTriangles: Math.max(...samples.map((s) => s.triangles)),
      geometries: [
        Math.min(...samples.map((s) => s.geometries)),
        Math.max(...samples.map((s) => s.geometries)),
      ],
      textures: [
        Math.min(...samples.map((s) => s.textures)),
        Math.max(...samples.map((s) => s.textures)),
      ],
      pixelRatio: samples.at(-1)!.pixelRatio,
      errors,
    });
    await page.screenshot({ path: resolve(output, `${scene.name}.png`) });
    await context.close();
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
