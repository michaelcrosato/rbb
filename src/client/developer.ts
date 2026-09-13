import { z } from 'zod';
import { DEFAULT_TUNING, tuningSchema, celestial } from '../shared/environment';
import type { Tuning } from '../shared/environment';
import { developerSchema } from '../shared/developer';
import { encodeSave, parseSave } from '../shared/save';
import type { SaveFile } from '../shared/save';
import { terrainHeight } from '../shared/world';
import { habitatValid } from '../shared/wildlife';
import { DEFAULT_GRAPHICS, graphicsSchema } from './render/settings';
import type { GraphicsSettings } from './render/settings';
import type { RenderSettings } from './render/renderer';
import type { Session } from './session';
import { developerMarkup } from './ui/developer';
import type { DeveloperTab } from './ui/developer';

const variationSchema = z
  .object({
    format: z.literal('rbb-variation'),
    version: z.literal(1),
    tuning: tuningSchema,
    graphics: graphicsSchema,
  })
  .strict();
const checkpointKey = 'rbb.developer.checkpoint.v1',
  presetsKey = 'rbb.developer.presets.v1';
interface Options {
  root: HTMLElement;
  session: () => Session | null;
  settings: () => RenderSettings;
  graphics: (value: GraphicsSettings) => void;
  notify: (message: string, error?: boolean) => void;
  look: (yaw: number, pitch: number) => void;
  restore: (save: SaveFile) => Promise<void>;
  download: (text: string, filename: string) => void;
}
export class DeveloperControls {
  tab: DeveloperTab = 'quick';
  paused = false;
  private checkpoint?: string;
  private previousTuning?: Tuning;
  private readonly retainedFields = new Map<string, string | boolean>();
  private readonly abort = new AbortController();
  constructor(private options: Options) {
    options.root.addEventListener(
      'change',
      (event) => {
        const input = event.target as HTMLInputElement;
        if (input.dataset.devFlag) void this.action('flag', input.dataset.devFlag);
        else if (input.dataset.devLive) void this.action(input.dataset.devLive);
        else if (input.id === 'dev-preset-file') void this.importVariation(input.files?.[0]);
      },
      { signal: this.abort.signal },
    );
  }
  attach(): void {
    this.paused = false;
    this.checkpoint = undefined;
    this.previousTuning = undefined;
    if (this.options.session()?.state.sandbox) {
      try {
        const raw = localStorage.getItem(checkpointKey);
        if (!raw) return;
        const save = parseSave(raw),
          session = this.options.session()!;
        if (save.state.seed === session.state.seed && save.playerId === session.playerId)
          this.checkpoint = raw;
      } catch {
        /* A damaged checkpoint must not affect the expedition. */
      }
    }
  }
  render(): void {
    const session = this.options.session();
    if (!session) return;
    const scroll = this.options.root.querySelector('.panel')?.scrollTop ?? 0;
    for (const id of [
      'dev-instant',
      'dev-species',
      'dev-count',
      'dev-preset-name',
      'dev-amount',
      'dev-item',
    ]) {
      const input = this.options.root.querySelector<HTMLInputElement>(`#${id}`);
      if (input)
        this.retainedFields.set(id, input.type === 'checkbox' ? input.checked : input.value);
    }
    this.options.root.querySelector('#panel-body')!.innerHTML = developerMarkup(
      session.state,
      session.state.players[session.playerId],
      this.options.settings(),
      session.devAllowed,
      this.tab,
      !!this.checkpoint,
      this.paused,
    );
    for (const [id, value] of this.retainedFields) {
      const input = this.options.root.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) continue;
      if (typeof value === 'boolean') input.checked = value;
      else input.value = value;
    }
    const panel = this.options.root.querySelector('.panel');
    if (panel) panel.scrollTop = scroll;
    this.update();
    const presets = this.options.root.querySelector('#dev-presets');
    if (presets)
      presets.textContent = `Saved on this device: ${Object.keys(this.presets()).join(', ') || 'none yet'}`;
    this.inspect();
  }
  update(): void {
    const session = this.options.session(),
      status = this.options.root.querySelector('#dev-status');
    if (!session || !status) return;
    const s = session.state,
      hour = s.environment.hours % 24;
    status.textContent = `${s.sandbox ? 'SANDBOX' : 'EXPEDITION'} · ${Math.floor(hour).toString().padStart(2, '0')}:${Math.floor(
      (hour % 1) * 60,
    )
      .toString()
      .padStart(
        2,
        '0',
      )} · ${s.environment.weather} · ${s.animals.filter((a) => a.health > 0).length}/96 animals · ${this.paused && session.mode === 'solo' ? 'Simulation paused' : 'World running'}`;
  }
  private capture(): void {
    const session = this.options.session();
    if (!session || session.mode !== 'solo') return;
    const raw = encodeSave(session.state, session.playerId);
    // Retain an in-memory fallback if browser quota prevents persistence.
    this.checkpoint = raw;
    try {
      localStorage.setItem(checkpointKey, raw);
    } catch {
      this.options.notify(
        'Checkpoint kept for this visit. Export your save for recovery after reload.',
        true,
      );
    }
  }
  private execute(request: unknown): void {
    const session = this.options.session();
    if (!session) return;
    const validated = developerSchema.safeParse(request);
    if (!validated.success) {
      this.options.notify('Check the values and displayed limits. Nothing was changed.', true);
      return;
    }
    if (!session.devAllowed) {
      this.options.notify('The host has disabled developer tools.', true);
      return;
    }
    if (!this.checkpoint) this.capture();
    session.command({ type: 'dev', request: validated.data });
  }
  private configure(tuning: Tuning): void {
    this.previousTuning = structuredClone(this.options.session()!.state.tuning);
    this.execute({ action: 'configure', tuning });
  }
  private values(attribute: string): Record<string, number | boolean> {
    return Object.fromEntries(
      [...this.options.root.querySelectorAll<HTMLInputElement>(`[data-${attribute}]`)].map(
        (input) => [
          input.getAttribute(`data-${attribute}`)!,
          input.type === 'checkbox' ? input.checked : Number(input.value),
        ],
      ),
    );
  }
  private value(id: string): string {
    return this.options.root.querySelector<HTMLInputElement>(`#dev-${id}`)?.value ?? '';
  }
  private inspect(): void {
    const session = this.options.session(),
      detail = this.options.root.querySelector('#dev-entity-detail');
    if (!session || !detail) return;
    const entity = [
      ...session.state.animals,
      ...session.state.buildings,
      ...session.state.bags,
    ].find((e) => e.id === this.value('entity'));
    detail.textContent = entity ? JSON.stringify(entity, null, 2) : 'No entity selected.';
  }
  private presets(): Record<string, z.infer<typeof variationSchema>> {
    try {
      return z
        .record(z.string().regex(/^[\p{L}\p{N} _-]{1,32}$/u), variationSchema)
        .refine((p) => Object.keys(p).length <= 10)
        .parse(JSON.parse(localStorage.getItem(presetsKey) ?? '{}'));
    } catch {
      return {};
    }
  }
  async action(action: string, value?: string): Promise<void> {
    const session = this.options.session();
    if (!session) return;
    const tuning = session.state.tuning;
    try {
      if (action === 'look') {
        const c = celestial(session.state.environment, tuning),
          d = value === 'moon' ? c.moon : c.sun;
        this.options.look(Math.atan2(-d.x, -d.z), Math.max(-1.45, Math.min(1.45, Math.asin(d.y))));
        return;
      }
      if (action === 'tab') this.tab = value as DeveloperTab;
      else if (action === 'time')
        this.execute({ action: 'time', hour: Number(value ?? this.value('hour')) });
      else if (action === 'speed') this.configure({ ...tuning, timeScale: Number(value) });
      else if (action === 'moon')
        this.configure({
          ...tuning,
          moonPhase:
            (((Number(value) - session.state.environment.hours / 24 / tuning.moonCycleDays) % 1) +
              1) %
            1,
        });
      else if (action === 'weather') {
        this.execute({
          action: 'weather',
          weather: this.value('weather'),
          instant: this.options.root.querySelector<HTMLInputElement>('#dev-instant')!.checked,
        });
        return;
      } else if (action === 'flag') {
        this.execute({
          action: 'flag',
          flag: value,
          value: this.options.root.querySelector<HTMLInputElement>(`[data-dev-flag="${value}"]`)!
            .checked,
        });
        return;
      } else if (['heal', 'kit', 'regrow'].includes(action)) this.execute({ action });
      else if (action === 'spawn')
        this.execute({
          action,
          species: this.value('species'),
          count: Number(this.value('count')),
        });
      else if (action === 'ground')
        this.execute({
          action,
          wetness: Number(this.value('wetness')),
          snowCover: Number(this.value('snow')),
        });
      else if (action === 'grant')
        this.execute({ action, item: this.value('item'), count: Number(this.value('amount')) });
      else if (action === 'teleport')
        this.execute({ action, x: Number(this.value('x')), z: Number(this.value('z')) });
      else if (action === 'landmark') {
        let position = { x: 0, z: 86 };
        if (value === 'coast') {
          const candidates: { x: number; z: number }[] = [];
          for (let x = -300; x <= 300; x += 10)
            for (let z = -300; z <= 300; z += 10)
              if (
                habitatValid(session.world, 'dolphin', x, z) &&
                terrainHeight(x, z, session.world.hash) > -8
              )
                candidates.push({ x, z });
          position =
            candidates.sort((a, b) => Math.hypot(a.x, a.z - 86) - Math.hypot(b.x, b.z - 86))[0] ??
            position;
        }
        this.execute({ action: 'teleport', ...position });
      } else if (action === 'inspect') {
        this.inspect();
        return;
      } else if (action === 'remove' || action === 'visit') {
        const entity = [
          ...session.state.animals,
          ...session.state.buildings,
          ...session.state.bags,
        ].find((e) => e.id === this.value('entity'));
        if (entity)
          this.execute(
            action === 'remove'
              ? { action, id: entity.id }
              : { action: 'teleport', x: entity.x, z: entity.z + 3 },
          );
      } else if (action === 'pause' || action === 'step') {
        if (session.mode !== 'solo')
          throw new Error('The shared server keeps running. Pause and stepping are solo tools.');
        if (action === 'pause') this.paused = !this.paused;
        else {
          this.paused = true;
          this.execute({ action: 'step', ticks: Number(value ?? 30) });
        }
      } else if (action === 'checkpoint') {
        if (session.mode !== 'solo') throw new Error('Checkpoints are available in solo.');
        this.capture();
        this.options.notify('Checkpoint captured.');
      } else if (action === 'restore' && this.checkpoint) {
        await this.options.restore(parseSave(this.checkpoint));
        return;
      } else if (action === 'apply-tuning')
        this.configure(tuningSchema.parse(this.values('tuning')));
      else if (action === 'reset-tuning') this.configure({ ...DEFAULT_TUNING });
      else if (action === 'undo-tuning') {
        if (this.previousTuning) this.configure(this.previousTuning);
        else throw new Error('No tuning change to undo in this visit.');
      } else if (action === 'apply-graphics')
        this.options.graphics(graphicsSchema.parse(this.values('graphics')));
      else if (action === 'reset-graphics') this.options.graphics({ ...DEFAULT_GRAPHICS });
      else if (action === 'save-preset' || action === 'load-preset') {
        const name = this.value('preset-name').trim(),
          presets = this.presets();
        if (
          !/^[\p{L}\p{N} _-]{1,32}$/u.test(name) ||
          ['constructor', 'prototype', '__proto__'].includes(name)
        )
          throw new Error('Name the preset using 1–32 letters, numbers, spaces or dashes.');
        if (action === 'save-preset') {
          if (!Object.hasOwn(presets, name) && Object.keys(presets).length >= 10)
            throw new Error('Ten presets are saved. Reuse a name to replace one.');
          presets[name] = {
            format: 'rbb-variation',
            version: 1,
            tuning: structuredClone(tuning),
            graphics: { ...this.options.settings().graphics },
          };
          localStorage.setItem(presetsKey, JSON.stringify(presets));
          this.options.notify(`Saved preset: ${name}.`);
        } else {
          if (!Object.hasOwn(presets, name)) throw new Error('No preset with that name.');
          this.configure(presets[name].tuning);
          this.options.graphics(presets[name].graphics);
        }
      } else if (action === 'export-preset')
        this.options.download(
          JSON.stringify(
            {
              format: 'rbb-variation',
              version: 1,
              tuning,
              graphics: this.options.settings().graphics,
            },
            null,
            2,
          ),
          'rbb-variation.json',
        );
      else if (action === 'import-preset') {
        this.options.root.querySelector<HTMLInputElement>('#dev-preset-file')!.click();
        return;
      }
      this.render();
    } catch (error) {
      this.options.notify(
        error instanceof z.ZodError
          ? 'Check the values and displayed limits. Nothing was changed.'
          : error instanceof Error
            ? error.message
            : 'Developer action failed.',
        true,
      );
    }
  }
  private async importVariation(file?: File): Promise<void> {
    if (!file) return;
    try {
      if (file.size > 64_000) throw new Error('Variation files must be smaller than 64 KB.');
      const data = variationSchema.parse(JSON.parse(await file.text()));
      this.configure(data.tuning);
      this.options.graphics(data.graphics);
      this.render();
    } catch {
      this.options.notify('Invalid variation file. Current settings were kept.', true);
    }
  }
  dispose(): void {
    this.abort.abort();
  }
}
