import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { buildCandidate } from '../src/shared/building';
import { encodeSave } from '../src/shared/save';
import { Simulation } from '../src/shared/simulation';
import { createState } from '../src/shared/state';
import { generateWorld, terrainHeight } from '../src/shared/world';
import { setWeather } from '../src/shared/environment';
import { habitatValid } from '../src/shared/wildlife';
import { ADVANCED_FEATURES, DEFAULT_GRAPHICS } from '../src/client/render/settings';
import type { GraphicsSettings } from '../src/client/render/settings';
import { diagnostics } from '../tests/e2e/helpers';

// Reproducible presentation fixtures enter through validated save import. No writable browser hooks.
const url = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:5173';
const output = resolve('.artifacts/rendering-benchmark');
await mkdir(output, { recursive: true });
const world = generateWorld('quiet-frontier'),
  sim = new Simulation(world, createState(world)),
  player = sim.addPlayer('local', 'Rendering lab');
Object.assign(sim.state.tuning, {
  timeScale: 0,
  weatherAutomatic: false,
  needsRate: 0,
  wildlifeSpeed: 0,
  windStrength: 0,
});
sim.state.sandbox = true;
player.dev.invincible = player.dev.flight = true;
sim.state.environment.hours = 9;
setWeather(sim.state.environment, 'cloudy', 0);
sim.state.environment.wetness = 1;
for (let i = 0; i < 50; i++) {
  const x = ((i % 10) - 4.5) * 4,
    z = 70 + Math.floor(i / 10) * 4;
  const base = buildCandidate(sim.state, world, 'foundation', x, z, 0);
  sim.state.buildings.push({ ...base, id: `b${sim.state.nextId++}`, owner: player.id });
  const kind = i < 25 ? 'wall' : i < 40 ? 'campfire' : 'bedroll';
  const extra = buildCandidate(sim.state, world, kind, base.x, base.z, 0);
  sim.state.buildings.push({ ...extra, id: `b${sim.state.nextId++}`, owner: player.id });
}
for (const resource of world.resources)
  if (
    sim.state.buildings.some(
      (building) => Math.hypot(building.x - resource.x, building.z - resource.z) < 3,
    )
  )
    sim.state.resources[resource.id] = { health: 0, respawnAt: 100000 };
const fixtures: Record<string, string> = {};
const coast = [];
for (let x = -300; x <= 300; x += 10)
  for (let z = -300; z <= 300; z += 10)
    if (habitatValid(world, 'dolphin', x, z) && terrainHeight(x, z, world.hash) > -8)
      coast.push({ x, z });
const shore = coast.sort((a, b) => Math.hypot(a.x, a.z - 86) - Math.hypot(b.x, b.z - 86))[0];
for (const [name, x, y, z, yaw, pitch] of [
  ['camp', 0, terrainHeight(0, 115, world.hash), 115, 0, -0.1],
  ['coast', shore.x, 2, shore.z, Math.atan2(shore.x, shore.z), -0.12],
  ['clouds', 80, 75, 220, 0, 0.16],
] as const) {
  player.position = { x, y, z };
  player.yaw = yaw;
  player.pitch = pitch;
  if (name === 'clouds') setWeather(sim.state.environment, 'clear', 0);
  fixtures[name] = resolve(output, `${name}.json`);
  await writeFile(fixtures[name], encodeSave(sim.state, player.id));
}
type Case = {
  name: string;
  settings: Partial<GraphicsSettings>;
  scene?: string;
  quality?: string;
  mobile?: boolean;
};
const cases: Case[] = [
  { name: 'baseline', settings: {} },
  ...ADVANCED_FEATURES.map((feature) => ({ name: feature, settings: { [feature]: true } })),
  {
    name: 'all-advanced',
    settings: Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, true])),
  },
  {
    name: 'all-effects',
    quality: 'high',
    settings: {
      ...Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, true])),
      bloom: true,
      ambientOcclusion: true,
      sunShafts: true,
      lensFlare: true,
      planarReflections: true,
    },
  },
  { name: 'coast-base', scene: 'coast', settings: {} },
  { name: 'coast-ssr', scene: 'coast', settings: { screenSpaceReflections: true } },
  { name: 'cloud-base', scene: 'clouds', settings: {} },
  { name: 'cloud-volume', scene: 'clouds', settings: { volumetricClouds: true } },
  {
    name: 'mobile-advanced',
    mobile: true,
    quality: 'mobile',
    settings: {
      volumetricClouds: true,
      volumetricFog: true,
      screenSpaceReflections: true,
      temporalUpscaling: true,
    },
  },
  {
    name: 'low-requested-advanced',
    quality: 'low',
    settings: Object.fromEntries(ADVANCED_FEATURES.map((key) => [key, true])),
  },
  { name: 'baseline-end', settings: {} },
];
const filter = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
const software = process.argv.includes('--software');
const browser = await chromium.launch({
  channel: software ? 'chromium' : 'chrome',
  args: software
    ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    : ['--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
const report: { recordedAt: string; method: string; scenes: unknown[] } = {
  recordedAt: new Date().toISOString(),
  method:
    'Fixed cloudy 09:00 100-piece camp, wet ground, still wind and wildlife; unchanged camera and imported simulation fixture. 6 s warmup (14 s for residency), then 12 half-second samples. GPU median of rolling 30-frame medians; GPU p95 is maximum observed rolling 30-frame p95. This machine only; mobile viewport is desktop GPU emulation. Target estimates exclude shadows, bloom, AO and reflection targets.',
  scenes: [],
};
try {
  for (const entry of cases.filter((entry) => !filter || entry.name.includes(filter))) {
    const context = await browser.newContext(
      entry.mobile
        ? {
            viewport: { width: 915, height: 412 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1920, height: 1080 } },
    );
    const page = await context.newPage(),
      errors: string[] = [],
      warnings: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /GL_INVALID|WebGL:|cannot be cloned|Feedback loop/.test(message.text())
      )
        errors.push(message.text());
      else if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#quality').selectOption(entry.quality ?? 'balanced');
    await page.getByText('Rendering effects', { exact: true }).click();
    await page.getByText('Advanced rendering · off by default', { exact: true }).click();
    const settings = { ...entry.settings, gpuTiming: true };
    for (const [key, value] of Object.entries(settings)) {
      const input = page.locator(`[data-graphics="${key}"]`);
      if (typeof value === 'boolean') await input.setChecked(value);
      else await input.fill(String(value));
    }
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await page.getByRole('button', { name: 'Field guide', exact: true }).click();
    await page.locator('#import-file').setInputFiles(fixtures[entry.scene ?? 'camp']);
    await page.waitForTimeout(entry.settings.chunkStreaming ? 14000 : 6000);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      samples.push((await diagnostics(page)).renderer);
      await page.waitForTimeout(500);
    }
    const gpu = await page.evaluate(() => {
      const gl = document.querySelector('canvas')!.getContext('webgl2')!,
        extension = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    });
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null;
    const d = await diagnostics(page);
    const row = {
      name: entry.name,
      scene: entry.scene ?? 'camp',
      quality: d.renderer.quality,
      gpu,
      viewport: page.viewportSize(),
      pixelRatio: d.renderer.pixelRatio,
      enabled: Object.entries({ ...DEFAULT_GRAPHICS, ...settings })
        .filter(([, value]) => value === true)
        .map(([key]) => key),
      medianFps: median(samples.map((s) => s.fps)),
      minimumOneSecondFps: Math.min(...samples.map((s) => s.fps)),
      medianGpuMs: median(samples.flatMap((s) => (s.gpuMs === null ? [] : [s.gpuMs]))),
      p95GpuMs: Math.max(...samples.map((s) => s.gpuP95Ms ?? 0)) || null,
      maxDrawCalls: Math.max(...samples.map((s) => s.drawCalls)),
      maxTriangles: Math.max(...samples.map((s) => s.triangles)),
      textures: d.renderer.textures,
      geometries: d.renderer.geometries,
      pipeline: d.pipeline,
      errors,
      warnings,
    };
    report.scenes.push(row);
    await page.screenshot({ path: resolve(output, `${entry.name}.png`) });
    await writeFile(
      resolve(output, filter ? `report-${filter}.json` : 'report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        name: entry.name,
        fps: row.medianFps,
        gpuMs: row.medianGpuMs,
        errors: errors.length,
        warnings: warnings.length,
      }),
    );
    await context.close();
    if (errors.length) throw new Error(`Rendering errors in ${entry.name}; see report.`);
  }
} finally {
  await browser.close();
}
