import { ITEM_IDS, ITEMS, SPECIES_IDS, WILDLIFE } from '../../shared/content';
import { carryCapacity } from '../../shared/inventory';
import type { GameState, PlayerState } from '../../shared/state';
import { WEATHER_IDS } from '../../shared/environment';
import { TERRAIN, TERRAIN_MODES } from '../../shared/terrain';
import { MAX_ANIMALS } from '../../shared/wildlife';
import type { Tuning } from '../../shared/environment';
import type { RenderSettings } from '../render/renderer';
import { ADVANCED_FEATURES } from '../render/settings';
import type { GraphicsSettings } from '../render/settings';
import { escapeHtml as esc } from './icons';

export type DeveloperTab = 'quick' | 'advanced' | 'graphics' | 'inspect' | 'terrain';
const button = (label: string, action: string, value = '') =>
  `<button class="button secondary" data-action="dev-${action}" data-value="${esc(value)}">${label}</button>`;
export const TUNING_FIELDS: Record<keyof Tuning, [string, number, number, number, string]> = {
  daySeconds: ['Day length', 60, 7200, 60, 'Real seconds per full day'],
  timeScale: ['Sky speed', 0, 120, 1, '0 freezes the sun; survival still runs'],
  latitude: ['Latitude', -65, 65, 1, 'Degrees north; changes sun arc'],
  season: ['Season', 0, 1, 0.01, '0 winter · 0.25 spring · 0.5 summer'],
  moonSize: ['Moon size', 0.25, 4, 0.25, 'Disc scale; light scales with area'],
  moonBrightness: ['Moon brightness', 0, 4, 0.1, 'Light multiplier'],
  moonPhase: ['Moon phase offset', 0, 1, 0.01, '0 new · 0.5 full; advances with days'],
  moonCycleDays: ['Lunar cycle', 1, 60, 1, 'World days per lunar cycle'],
  starBrightness: ['Star brightness', 0, 3, 0.1, 'Night sky intensity'],
  weatherAutomatic: ['Automatic weather', 0, 1, 1, 'Choose weather deterministically over time'],
  weatherPeriod: ['Weather interval', 30, 3600, 10, 'Real seconds between weather choices'],
  weatherTransition: ['Weather transition', 0, 120, 1, 'Seconds to blend into a new condition'],
  windStrength: ['Wind strength', 0, 3, 0.1, 'Cloud, foliage and precipitation movement'],
  windDirection: ['Wind direction', 0, 360, 5, 'Degrees; 0 blows south'],
  precipitation: ['Precipitation', 0, 2, 0.1, 'Rain and snow particle density'],
  fogDensity: ['Fog density', 0.25, 3, 0.05, 'Visibility multiplier'],
  waveHeight: ['Wave height', 0, 2, 0.1, 'Water displacement; weather adds roughness'],
  movementSpeed: ['Movement speed', 0.25, 4, 0.25, 'Walk, sprint and swim multiplier'],
  jumpHeight: ['Jump height', 0.25, 3, 0.25, 'Jump energy multiplier'],
  gravity: ['Gravity', 0.25, 3, 0.25, 'Gravity multiplier'],
  needsRate: ['Hunger and thirst', 0, 10, 0.25, '0 disables depletion'],
  damage: ['Incoming damage', 0, 5, 0.25, 'Falls, starvation and wildlife damage'],
  gatherYield: ['Gather yield', 1, 10, 1, 'Integer reward multiplier; carry limit still applies'],
  resourceRespawn: ['Resource respawn', 0.01, 10, 0.01, 'Delay multiplier for future depletion'],
  wildlifeSpeed: ['Wildlife speed', 0, 4, 0.25, '0 freezes movement'],
  wildlifeAggression: [
    'Wildlife aggression',
    0,
    3,
    0.25,
    'Detection range; 0 makes predators passive',
  ],
  wildlifeRespawn: ['Wildlife respawn', 10, 3600, 10, 'Seconds after a future kill'],
};
const field = (
  key: string,
  value: number | boolean,
  metadata: [string, number, number, number, string],
  prefix: string,
) => {
  const [label, min, max, step, help] = metadata;
  return `<label class="dev-field"><span>${label}</span>${typeof value === 'boolean' ? `<input type="checkbox" data-${prefix}="${key}" ${value ? 'checked' : ''}>` : `<input type="number" data-${prefix}="${key}" min="${min}" max="${max}" step="${step}" value="${value}">`}<small>${help}</small></label>`;
};
export function graphicsMarkup(graphics: GraphicsSettings, debug = false): string {
  const labels: Record<string, string> = {
    cascadedShadows: 'Cascaded shadows',
    volumetricClouds: 'Volumetric clouds',
    volumetricFog: 'Volumetric fog',
    globalIllumination: 'Probe indirect lighting',
    screenSpaceReflections: 'Screen-space reflections',
    temporalUpscaling: 'Temporal upscaling',
    motionBlur: 'Motion blur',
    depthOfField: 'Depth of field',
    gpuOcclusion: 'GPU occlusion culling',
    chunkStreaming: 'Stream distant GPU buffers',
    gpuTiming: 'Measure GPU frame time',
    eyeAdaptation: 'Eyes adapt to darkness',
    shadows: 'Dynamic shadows (Balanced / High)',
    atmosphere: 'Sky, stars and clouds',
    particles: 'Rain, snow and underwater particles',
    wind: 'Foliage wind',
    waterDetails: 'Waves, sun reflections and foam',
    localLights: 'Campfire lights',
    bloom: 'Bloom',
    ambientOcclusion: 'Ambient occlusion',
    sunShafts: 'Sun shafts',
    lensFlare: 'Lens flare',
    planarReflections: 'Reflections of the coast',
    ambientParticles: 'Dust, fireflies and embers',
    wireframe: 'Wireframe',
    collisionDebug: 'Collision bounds',
  };
  const numeric: Record<string, [string, number, number, number, string]> = {
    effectResolution: ['Volume resolution', 0.25, 1, 0.25, 'Fraction of internal resolution'],
    volumeSteps: ['Volume samples', 8, 64, 8, 'More samples reduce banding'],
    cloudAltitude: ['Cloud base height', 40, 240, 5, 'Metres above sea level'],
    cloudThickness: ['Cloud thickness', 15, 120, 5, 'Metres'],
    fogStrength: ['Volume fog density', 0.1, 3, 0.1, 'Multiplies weather density'],
    giStrength: ['Indirect light strength', 0, 2, 0.05, 'Diffuse light from nearby surfaces'],
    reflectionStrength: ['Screen reflection strength', 0, 1, 0.05, 'Wet ground and water'],
    temporalScale: ['Temporal input scale', 0.5, 1, 0.05, 'Lower values reduce scene pixels'],
    motionBlurStrength: ['Shutter strength', 0, 1, 0.05, 'Camera and object motion'],
    focusDistance: ['Focus distance', 1, 150, 1, 'Metres'],
    aperture: ['Aperture', 0, 0.05, 0.001, '0 keeps everything sharp'],
    shadowDistance: ['Cascade reach', 80, 500, 20, 'Metres'],
    shadowCascades: ['Shadow cascades', 2, 4, 1, 'More maps cost more draws and memory'],
    streamingDistance: ['GPU residency radius', 128, 640, 32, 'Metres; buffers reload on return'],
    exposure: ['Exposure', 0.25, 2.5, 0.05, 'Scene brightness'],
    saturation: ['Saturation', 0, 2, 0.05, 'Optional color grading'],
    contrast: ['Contrast', 0.5, 1.5, 0.05, 'Optional color grading'],
    viewDistance: ['View distance', 0.5, 1.5, 0.1, 'Distant detail'],
    resolutionScale: ['Resolution scale', 0.5, 1.5, 0.1, 'Relative to the quality preset'],
  };
  const advanced = new Set<string>([
    ...ADVANCED_FEATURES,
    'effectResolution',
    'volumeSteps',
    'cloudAltitude',
    'cloudThickness',
    'fogStrength',
    'giStrength',
    'reflectionStrength',
    'temporalScale',
    'motionBlurStrength',
    'focusDistance',
    'aperture',
    'shadowDistance',
    'shadowCascades',
    'streamingDistance',
  ]);
  const fields = (extra: boolean) =>
    Object.entries(graphics)
      .filter(([key]) => advanced.has(key) === extra)
      .filter(
        ([key]) =>
          key !== 'bufferView' && (debug || !['wireframe', 'collisionDebug'].includes(key)),
      )
      .map(([key, value]) =>
        field(
          key,
          value as number | boolean,
          numeric[key] ?? [labels[key], 0, 1, 1, ''],
          'graphics',
        ),
      )
      .join('');
  return `<p class="muted small">Optional effects use more GPU power. Low suppresses expensive effects and keeps your preferences for other presets. Gameplay and progression stay the same.</p><div class="dev-fields">${fields(false)}</div><details><summary>Advanced rendering · off by default</summary><p class="muted small">Try each effect separately. Higher presets never enable these automatically. Temporal upscaling trades detail for speed; camera blur is a style preference.</p><div class="dev-fields">${fields(true)}</div></details>${debug ? `<label class="dev-field"><span>Shared buffer view</span><select data-graphics="bufferView">${['off', 'depth', 'normals', 'velocity'].map((value) => `<option ${graphics.bufferView === value ? 'selected' : ''}>${value}</option>`).join('')}</select><small>Rendering diagnostics; off restores the final image</small></label>` : ''}<p id="rendering-status" class="muted small" role="status"></p>`;
}
export function developerMarkup(
  state: GameState,
  p: PlayerState,
  settings: RenderSettings,
  allowed: boolean,
  tab: DeveloperTab,
  checkpoint: boolean,
  paused: boolean,
): string {
  const tabs = (['quick', 'terrain', 'advanced', 'graphics', 'inspect'] as const)
    .map(
      (t) =>
        `<button role="tab" aria-selected="${tab === t}" data-action="dev-tab" data-value="${t}">${{ quick: 'Quick tools', terrain: 'Terrain', advanced: 'World variables', graphics: 'Rendering', inspect: 'Inspector' }[t]}</button>`,
    )
    .join('');
  let body: string;
  if (!allowed && tab !== 'graphics')
    body =
      '<p>This server has developer tools disabled. Rendering controls are available on your device.</p>';
  else if (tab === 'quick')
    body = `
    <section><h3>Sky & weather</h3><div class="dev-buttons">${button('Dawn', 'time', '6')}${button('Noon', 'time', '12')}${button('Dusk', 'time', '18')}${button('Midnight', 'time', '0')}</div>
    <label class="dev-field"><span>Time of day</span><input id="dev-hour" type="range" min="0" max="23.99" step=".05" value="${state.environment.hours % 24}" data-dev-live="time"><small>Scrub and release to preview</small></label>
    <div class="dev-buttons">${button(state.tuning.timeScale ? 'Freeze sky' : 'Run sky', 'speed', state.tuning.timeScale ? '0' : '1')}${button('10× sky', 'speed', '10')}${button('60× sky', 'speed', '60')}${button('New moon', 'moon', '0')}${button('Full moon', 'moon', '.5')}${button('Face sun', 'look', 'sun')}${button('Face moon', 'look', 'moon')}</div>
    <label class="dev-field"><span>Weather</span><select id="dev-weather" data-dev-live="weather">${WEATHER_IDS.map((w) => `<option ${state.environment.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select><small>Uses the configured transition time</small></label><label class="check"><input id="dev-instant" type="checkbox">Instant weather changes</label>
    </section><section><h3>Survivor</h3><div class="dev-buttons">${button('Restore vitals', 'heal')}${button('Replace pack with test kit', 'kit')}${button('Return to Haven', 'landmark', 'haven')}${button('Visit the coast', 'landmark', 'coast')}</div>
    <div class="dev-flags">${(['invincible', 'flight', 'freeBuild'] as const).map((flag) => `<label class="check"><input type="checkbox" data-dev-flag="${flag}" ${p.dev[flag] ? 'checked' : ''}>${{ invincible: 'Invincible', flight: 'Fly / noclip', freeBuild: 'Free building' }[flag]}</label>`).join('')}</div><p class="muted small">Flight: look where you want to go and press W. Hold Space/Jump to rise; C/Dive to descend. Free building keeps placement and world limits.</p></section>
    <section><h3>Wildlife</h3><div class="dev-inline"><label>Species<select id="dev-species">${SPECIES_IDS.map((s) => `<option value="${s}">${WILDLIFE[s].name} · ${WILDLIFE[s].habitat}</option>`).join('')}</select></label><label>Count<input id="dev-count" type="number" min="1" max="10" value="1"></label>${button('Spawn nearby', 'spawn')}</div><p class="muted small">Marine species need deep water nearby. ${MAX_ANIMALS} animal limit.</p></section>
    <section><h3>Repeat a test</h3><div class="dev-buttons">${button(paused ? 'Run simulation' : 'Pause simulation', 'pause')}${button('Step one second', 'step', '30')}${button('Step ten seconds', 'step', '300')}${button('Regrow resources', 'regrow')}${button('Capture checkpoint', 'checkpoint')}<button class="button secondary" data-action="dev-restore" ${checkpoint ? '' : 'disabled'}>Restore checkpoint</button></div><p class="muted small">Solo checkpoints include the whole expedition. The original is captured before your first change. Online testers use the host’s world backups.</p></section>`;
  else if (tab === 'terrain')
    body = `<p class="panel-description">Sculpt banks, tunnels and level building sites. The preview shows the brush volume. Edits preserve occupied space and structure supports.</p>
    <div class="dev-fields"><label class="dev-field"><span>Terrain operation</span><select id="dev-terrain-mode">${TERRAIN_MODES.map((mode) => `<option value="${mode}">${{ dig: 'Excavate', add: 'Build up', flatten: 'Flatten to height', smooth: 'Smooth', restore: 'Restore seeded terrain' }[mode]}</option>`).join('')}</select></label>
    <label class="dev-field"><span>Brush shape</span><select id="dev-terrain-shape"><option value="sphere">Sphere</option><option value="box">Box</option></select></label>
    <label class="dev-field"><span>Brush radius (m)</span><input id="dev-terrain-radius" type="number" min="1" max="12" step="0.5" value="4"><small>Box uses this half-size on all axes.</small></label>
    <label class="dev-field"><span>Brush strength</span><input id="dev-terrain-strength" type="number" min="0.1" max="1" step="0.1" value="1"></label>
    <label class="dev-field"><span>Flatten height (m)</span><input id="dev-terrain-level" type="number" min="-62" max="126" step="0.25" value="${p.position.y.toFixed(2)}"></label></div>
    <div class="dev-buttons">${button('Sculpt in world', 'terrain-paint')}${button('Sample aimed surface', 'terrain-sample')}</div><p class="muted small">Sculpt mode: aim and hold E / left click, or tap Use. Range 80 m. R / ↻ samples a level. T opens terrain tools. Flight is available under Quick tools.</p>
    <section><h3>Place a precise brush</h3><div class="dev-inline">${(['x', 'y', 'z'] as const).map((axis) => `<label>Center ${axis.toUpperCase()}<input id="dev-terrain-${axis}" type="number" min="${axis === 'y' ? -62 : -310}" max="${axis === 'y' ? 126 : 310}" step="0.25" value="${(axis === 'z' ? p.position.z - 6 : p.position[axis]).toFixed(2)}"></label>`).join('')}</div><div class="dev-buttons">${button('Apply terrain brush', 'terrain-stamp')}</div></section>
    <section><h3>Recovery</h3><p class="muted small">${Object.keys(state.terrain.samples).length.toLocaleString()} / ${TERRAIN.maxSamples.toLocaleString()} edited samples. Restore seeded terrain releases samples. Solo captures a whole-world checkpoint before the first developer mutation.</p><div class="dev-buttons">${button('Capture checkpoint', 'checkpoint')}<button class="button secondary" data-action="dev-restore" ${checkpoint ? '' : 'disabled'}>Restore checkpoint</button></div></section>`;
  else if (tab === 'advanced')
    body = `<p class="muted small">Change a group of values and apply. Ranges are validated by the simulation. Values are saved with the world and shared online.</p><div class="dev-fields">${(Object.keys(TUNING_FIELDS) as (keyof Tuning)[]).map((key) => field(key, state.tuning[key], TUNING_FIELDS[key], 'tuning')).join('')}</div><div class="dev-buttons">${button('Apply world variables', 'apply-tuning')}${button('Reset world defaults', 'reset-tuning')}${button('Undo last tuning change', 'undo-tuning')}</div><section><h3>Surface state</h3><div class="dev-inline"><label>Wetness (0–1)<input id="dev-wetness" type="number" min="0" max="1" step=".1" value="${state.environment.wetness.toFixed(2)}"></label><label>Snow cover (0–1)<input id="dev-snow" type="number" min="0" max="1" step=".1" value="${state.environment.snowCover.toFixed(2)}"></label>${button('Apply surfaces', 'ground')}</div><p class="muted small">Weather continues accumulating or drying these surfaces.</p></section><section><h3>Variation presets</h3><div class="dev-inline"><label>Preset name<input id="dev-preset-name" maxlength="32" placeholder="Stormy long nights"></label>${button('Save preset', 'save-preset')}${button('Load preset', 'load-preset')}</div><p id="dev-presets" class="muted small"></p><div class="dev-buttons">${button('Export variation', 'export-preset')}${button('Import variation', 'import-preset')}</div><input type="file" id="dev-preset-file" accept=".json,application/json" hidden></section>`;
  else if (tab === 'graphics') {
    body = `${graphicsMarkup(settings.graphics, true)}<div class="dev-buttons">${button('Apply rendering', 'apply-graphics')}${button('Reset rendering defaults', 'reset-graphics')}</div>`;
  } else {
    const entities = [
      ...state.animals
        .filter((a) => a.health > 0)
        .map((a) => ({ name: `${WILDLIFE[a.species].name} · ${a.behavior}`, ...a })),
      ...state.buildings.map((b) => ({ name: b.kind, ...b })),
      ...state.bags.map((b) => ({ name: 'Supply pack', ...b })),
    ].sort(
      (a, b) =>
        Math.hypot(a.x - p.position.x, a.z - p.position.z) -
        Math.hypot(b.x - p.position.x, b.z - p.position.z),
    );
    body = `<section><h3>World entities</h3><label class="dev-field"><span>Inspect entity (nearest first)</span><select id="dev-entity" data-dev-live="inspect">${entities.map((e) => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.id)} · ${Math.round(Math.hypot(e.x - p.position.x, e.z - p.position.z))} m</option>`).join('')}</select></label><pre id="dev-entity-detail"></pre><div class="dev-buttons">${button('Travel to entity', 'visit')}${button('Remove selected entity', 'remove')}${button('Refresh list', 'tab', 'inspect')}</div></section><section><h3>Precise travel</h3><div class="dev-inline"><label>X (east)<input id="dev-x" type="number" min="-310" max="310" value="${Math.round(p.position.x)}"></label><label>Z (south)<input id="dev-z" type="number" min="-310" max="310" value="${Math.round(p.position.z)}"></label>${button('Teleport', 'teleport')}</div></section><section><h3>Inventory</h3><div class="dev-inline"><label>Item<select id="dev-item">${ITEM_IDS.map((i) => `<option value="${i}">${ITEMS[i].name}</option>`).join('')}</select></label><label>Amount<input id="dev-amount" type="number" min="1" max="100" value="10"></label>${button('Grant item', 'grant')}</div><p class="muted small">The ${carryCapacity(p)} kg pack limit is always enforced.</p></section>`;
  }
  return `<h2 id="panel-title">Developer tools</h2><p class="dev-status" id="dev-status"></p><div role="tablist" aria-label="Developer sections" class="dev-tabs">${tabs}</div><div class="dev-content">${body}</div>`;
}
