import { z } from 'zod';
import { graphicsSchema, DEFAULT_GRAPHICS } from './render/settings';
import { DeveloperControls } from './developer';
import { version } from '../../package.json';
import { buildCandidate, validateBuild } from '../shared/building';
import { isConsumable } from '../shared/content';
import type { BuildingKind, ItemId, RecipeId } from '../shared/content';
import { MAX_SAVE_BYTES, parseSave, encodeSave } from '../shared/save';
import type { SaveFile } from '../shared/save';
import type { Building, PlayerState } from '../shared/state';
import { DEFAULT_SEED, generateWorld } from '../shared/world';
import { GameAudio } from './audio';
import { Input } from './input';
import type { InputAction } from './input';
import { SaveStore } from './persistence';
import { DEFAULT_SETTINGS, WorldRenderer } from './render/renderer';
import type { RenderSettings, Target } from './render/renderer';
import { getSnapshot, LocalSession, RemoteSession } from './session';
import type { Session } from './session';
import { HOTBAR, UI } from './ui/ui';
import type { Panel } from './ui/ui';
import { normalizeServerUrl, worldInviteUrl } from './multiplayer';

const settingsSchema = z.object({
  quality: z.enum(['auto', 'high', 'balanced', 'mobile', 'low']),
  sensitivity: z.number().min(0.3).max(2.5),
  volume: z.number().min(0).max(1),
  fov: z.number().min(55).max(100),
  showStats: z.boolean(),
  graphics: graphicsSchema.default(DEFAULT_GRAPHICS),
});
const seedSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[\p{L}\p{N} _-]+$/u);

export class Game {
  readonly ui: UI;
  readonly renderer: WorldRenderer;
  readonly input: Input;
  readonly audio = new GameAudio();
  readonly saves: SaveStore;
  readonly developer: DeveloperControls;
  session: Session | null = null;
  private settings: RenderSettings = { ...DEFAULT_SETTINGS };
  private saved: SaveFile | null = null;
  private buildKind: BuildingKind | null = null;
  private rotation = 0;
  private target: Target | null = null;
  private candidate: Omit<Building, 'id' | 'owner'> | null = null;
  private previousFrame = 0;
  private uiTime = 0;
  private saveTime = 0;
  private lastAction = 0;
  private syncedTick = -1;
  private request = 0;
  private disposed = false;
  private connecting = false;
  private readonly abort = new AbortController();

  constructor(root: HTMLElement) {
    this.ui = new UI(root);
    this.saves = new SaveStore({
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    });
    const loaded = this.saves.load();
    this.saved = loaded.save;
    this.ui.setHasSave(
      !!this.saved,
      this.saved
        ? `Saved expedition · ${this.saved.state.seed} · ${new Date(this.saved.savedAt).toLocaleDateString()}`
        : loaded.warning,
    );
    try {
      const parsed = settingsSchema.safeParse(
        JSON.parse(localStorage.getItem('rbb.settings.v1') ?? 'null'),
      );
      if (parsed.success) this.settings = parsed.data;
    } catch {}
    try {
      const recent = z
        .object({ serverUrl: z.string(), name: seedSchema.max(24) })
        .parse(JSON.parse(localStorage.getItem('rbb.multiplayer.v1') ?? 'null'));
      this.ui.joinDefaults = { ...recent, serverUrl: normalizeServerUrl(recent.serverUrl) };
    } catch {}
    this.renderer = new WorldRenderer(this.ui.canvas, generateWorld(DEFAULT_SEED));
    this.renderer.applySettings(this.settings);
    this.input = new Input(this.ui.canvas, (action, value) => this.inputAction(action, value));
    this.input.bindTouch(root);
    this.input.sensitivity = this.settings.sensitivity;
    this.audio.volume = this.settings.volume;
    this.ui.onAction = (action, value) => {
      void this.action(action, value).catch((e) =>
        this.ui.toast(e instanceof Error ? e.message : 'That action could not be completed.', true),
      );
    };
    this.developer = new DeveloperControls({
      root,
      session: () => this.session,
      settings: () => this.settings,
      graphics: (graphics) => {
        this.settings = { ...this.settings, graphics };
        this.renderer.applySettings(this.settings);
        try {
          localStorage.setItem('rbb.settings.v1', JSON.stringify(this.settings));
        } catch {}
      },
      look: (yaw, pitch) => {
        this.input.yaw = yaw;
        this.input.pitch = pitch;
      },
      notify: (message, error) => this.ui.toast(message, error),
      restore: async (save) => {
        await this.attach(new LocalSession(save.state.seed, save.state, save.playerId));
        this.save();
        this.openPanel('developer');
        this.ui.toast('Checkpoint restored.');
      },
      download: (text, filename) => this.download(text, filename),
    });
    const signal = this.abort.signal;
    document.addEventListener(
      'pointerlockchange',
      () => {
        // A slow pointer-lock request can finish after the player opens a panel.
        // Release that late grant so the canvas cannot capture clicks meant for controls.
        if (document.pointerLockElement && (this.ui.panel || !this.session))
          document.exitPointerLock();
        else if (!document.pointerLockElement && this.session && !this.ui.panel)
          this.openPanel('pause');
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden && this.session) this.openPanel('pause');
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.session && !this.ui.panel) this.openPanel('pause');
      },
      { signal },
    );
    window.addEventListener('pagehide', () => this.save(), { signal });
    this.ui.canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        this.openPanel('pause');
        this.ui.fatal(
          'The graphics context was interrupted. Waiting for your browser to restore it. Your latest progress has been saved where storage is available; you can also reload the game.',
        );
      },
      { signal },
    );
    this.ui.canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.ui.root.querySelector<HTMLElement>('#fatal')!.hidden = true;
        this.ui.toast('Graphics restored. Your rendering preferences were kept.');
      },
      { signal },
    );
    this.ui.canvas.addEventListener(
      'dblclick',
      () => {
        if (this.session && !this.ui.panel) void this.lockPointer();
      },
      { signal },
    );
    root.querySelector<HTMLInputElement>('#import-file')!.addEventListener(
      'change',
      (e) => {
        void this.importFile((e.target as HTMLInputElement).files?.[0]);
        (e.target as HTMLInputElement).value = '';
      },
      { signal },
    );
    if (loaded.warning) this.ui.toast(loaded.warning, true);
    const invitedWorld = new URL(location.href).searchParams.get('world');
    if (invitedWorld) {
      try {
        this.ui.joinDefaults.serverUrl = normalizeServerUrl(invitedWorld);
        this.openPanel('online');
      } catch (error) {
        this.ui.toast(error instanceof Error ? error.message : 'Invalid world invite.', true);
      }
    }
    this.request = requestAnimationFrame((time) => this.frame(time));
  }

  private player(): PlayerState | undefined {
    return this.session?.state.players[this.session.playerId];
  }
  private async lockPointer(): Promise<void> {
    if (matchMedia('(pointer: coarse)').matches || this.ui.panel || !this.session) return;
    try {
      await this.ui.canvas.requestPointerLock();
    } catch {
      this.ui.toast('Drag the world to look. Double-click to capture the mouse; E gathers.');
    }
  }
  private openPanel(panel: Panel): void {
    this.input.reset();
    this.input.active = false;
    if (this.session) {
      this.session.command({ type: 'move', input: this.input.sample() });
      if (this.session.mode === 'solo') this.save();
    }
    this.ui.showPanel(panel, this.player(), this.settings);
    if (panel === 'team' && this.session)
      this.ui.updateTeam(this.session.state, this.player()!, this.session.status);
    if (panel === 'map' && this.session)
      this.ui.drawMap(this.session.world, this.session.state, this.player()!);
    if (panel === 'developer') this.developer.render();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  private resume(): void {
    if (this.player()?.health === 0) {
      this.openPanel('death');
      return;
    }
    this.ui.hidePanel();
    this.input.reset();
    this.input.active = !!this.session;
    if (this.session) void this.lockPointer();
  }

  private inputAction(action: InputAction, value?: number): void {
    if (action === 'developer') {
      if (this.session) {
        if (this.ui.panel === 'developer') this.resume();
        else this.openPanel('developer');
      }
      return;
    }
    if (action === 'pause') {
      if (this.ui.panel) this.resume();
      else if (this.session) this.openPanel('pause');
      return;
    }
    if (!this.session) return;
    if (action === 'slot') {
      void this.action('slot', String(value));
      return;
    }
    if (action === 'inventory' || action === 'build' || action === 'map') {
      if (this.ui.panel === action) this.resume();
      else if (action === 'build' && this.buildKind && !this.ui.panel) this.cancelBuild();
      else this.openPanel(action);
      return;
    }
    if (!this.input.active) return;
    if (action === 'interact') this.interact();
    if (action === 'rotate') this.rotation = (this.rotation + 1) % 4;
    if (action === 'consume') this.consume();
  }

  private async action(action: string, value?: string): Promise<void> {
    if (action.startsWith('dev-')) {
      await this.developer.action(action.slice(4), value);
      return;
    }
    if (action === 'developer' && this.session) {
      this.openPanel('developer');
      return;
    }
    if (action === 'start') {
      if (this.saved) this.openPanel('new');
      else await this.startNew();
    } else if (action === 'new-confirmed') await this.startNew();
    else if (action === 'continue' && this.saved)
      await this.attach(
        new LocalSession(
          this.saved.state.seed,
          parseSave(JSON.stringify(this.saved)).state,
          this.saved.playerId,
        ),
      );
    else if (action === 'close' || action === 'resume') this.resume();
    else if (
      ['inventory', 'build', 'map', 'pause', 'settings', 'guide', 'online', 'team'].includes(action)
    )
      this.openPanel(action as Panel);
    else if (action === 'apply-settings') {
      const root = this.ui.root;
      const graphics = { ...this.settings.graphics };
      root.querySelectorAll<HTMLInputElement>('[data-graphics]').forEach((input) => {
        Object.assign(graphics, {
          [input.dataset.graphics!]:
            input.tagName === 'SELECT'
              ? input.value
              : input.type === 'checkbox'
                ? input.checked
                : Number(input.value),
        });
      });
      const validation = graphicsSchema.safeParse(graphics);
      if (!validation.success) {
        this.ui.toast('Check rendering values against their allowed ranges.', true);
        return;
      }
      this.settings = settingsSchema.parse({
        graphics: validation.data,
        quality: (root.querySelector('#quality') as HTMLSelectElement).value,
        fov: Number((root.querySelector('#fov') as HTMLInputElement).value),
        sensitivity: Number((root.querySelector('#sensitivity') as HTMLInputElement).value),
        volume: Number((root.querySelector('#volume') as HTMLInputElement).value),
        showStats: (root.querySelector('#show-stats') as HTMLInputElement).checked,
      });
      this.renderer.applySettings(this.settings);
      this.input.sensitivity = this.settings.sensitivity;
      this.audio.volume = this.settings.volume;
      try {
        localStorage.setItem('rbb.settings.v1', JSON.stringify(this.settings));
      } catch {
        this.ui.toast('Settings applied for this visit. Browser storage is unavailable.', true);
      }
      this.resume();
    } else if (action === 'slot' && this.session) {
      const index = Number(value);
      if (index === 5) {
        this.openPanel('build');
        return;
      }
      if (HOTBAR[index]) {
        this.cancelBuild();
        this.session.command({ type: 'equip', item: HOTBAR[index] });
      }
    } else if (action === 'item' && this.session) {
      if (isConsumable(value as ItemId))
        this.session.command({ type: 'consume', item: value as ItemId });
      else this.session.command({ type: 'equip', item: value as ItemId });
    } else if (action === 'craft')
      this.session?.command({ type: 'craft', recipe: value as RecipeId });
    else if (action === 'select-build') {
      this.buildKind = value as BuildingKind;
      this.rotation = 0;
      this.resume();
    } else if (action === 'interact' && this.input.active) this.interact();
    else if (action === 'rotate') this.rotation = (this.rotation + 1) % 4;
    else if (action === 'consume') this.consume();
    else if (action === 'respawn') {
      this.session?.command({ type: 'respawn' });
      if (this.session?.mode === 'solo') this.resume();
    } else if (action === 'menu') {
      this.save();
      this.session?.close();
      this.session = null;
      this.audio.environment(0, 0, 0, false);
      this.input.active = false;
      this.input.reset();
      this.cancelBuild();
      this.ui.hidePanel();
      this.ui.showGame(false);
      this.renderer.showPreview(null, false);
      this.target = null;
      if (document.pointerLockElement) document.exitPointerLock();
      const loaded = this.saves.load();
      this.saved = loaded.save;
      this.ui.setHasSave(!!this.saved);
    } else if (action === 'export' && this.session?.mode === 'solo')
      this.download(encodeSave(this.session.state, this.session.playerId));
    else if (action === 'export-existing' && this.saved) this.download(JSON.stringify(this.saved));
    else if (action === 'import')
      this.ui.root.querySelector<HTMLInputElement>('#import-file')!.click();
    else if (action === 'connect') await this.connect();
    else if (action === 'copy-invite' && this.ui.inviteUrl) {
      try {
        await navigator.clipboard.writeText(this.ui.inviteUrl);
        this.ui.toast('Invite link copied. Send it to your crew.');
      } catch {
        this.ui.root.querySelector<HTMLInputElement>('#world-invite')?.select();
        this.ui.toast('Select and copy the invite link above.');
      }
    } else if (action === 'reload') location.reload();
  }

  private async startNew(): Promise<void> {
    const result = seedSchema.safeParse(
      (this.ui.root.querySelector('#world-seed') as HTMLInputElement).value,
    );
    if (!result.success) {
      this.ui.toast(
        'Use 1–48 letters, numbers, spaces, underscores, or dashes for your world seed.',
        true,
      );
      return;
    }
    await this.attach(new LocalSession(result.data));
    this.save();
  }

  private async attach(session: Session): Promise<void> {
    this.session?.close();
    this.session = session;
    this.ui.inviteUrl = session instanceof RemoteSession ? worldInviteUrl(session.serverUrl) : '';
    this.developer.attach();
    this.renderer.setWorld(session.world);
    this.syncedTick = -1;
    this.cancelBuild();
    const player = this.player()!;
    this.input.yaw = player.yaw;
    this.input.pitch = player.pitch;
    session.onResult = (result) => {
      this.ui.toast(result.message, !result.ok);
      if (this.ui.panel === 'developer') this.developer.render();
      if (result.ok && this.ui.panel === 'death' && this.player()!.health > 0) this.resume();
    };
    session.onEvents = (events) =>
      events
        .filter((e) => e.playerId === session.playerId)
        .forEach((event) => {
          this.ui.toast(event.message, event.type === 'death');
          this.audio.play(event.type);
          if (event.type === 'gather') this.renderer.swingTool();
        });
    // Menus can open before the next render frame. Initialize their session and
    // player state now so an online join cannot expose the previous solo controls.
    this.ui.update(
      session.state,
      player,
      session.world,
      player.yaw,
      null,
      session.mode,
      session.status,
    );
    this.ui.showGame(true);
    this.ui.hidePanel();
    this.input.active = true;
    this.input.reset();
    this.saveTime = 0;
    void this.audio.unlock();
    this.ui.toast('Welcome to Haven. Gather flax ahead, then find timber and stone.');
    await this.lockPointer();
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    const root = this.ui.root,
      status = root.querySelector('#connect-status')!;
    const name = (root.querySelector('#survivor-name') as HTMLInputElement).value.trim();
    if (!/^[\p{L}\p{N} _-]{1,24}$/u.test(name)) {
      status.textContent =
        'Use 1–24 letters, numbers, spaces, underscores or dashes for your name.';
      return;
    }
    this.connecting = true;
    const button = root.querySelector<HTMLButtonElement>('[data-action="connect"]')!;
    button.disabled = true;
    status.textContent = 'Connecting to the world…';
    try {
      const session = await RemoteSession.connect(
        (root.querySelector('#server-url') as HTMLInputElement).value.trim(),
        name,
        (root.querySelector('#fresh-survivor') as HTMLInputElement).checked,
      );
      if (this.ui.panel !== 'online' || root.querySelector('#connect-status') !== status)
        session.close();
      else {
        this.ui.joinDefaults = {
          serverUrl: session.serverUrl,
          name: session.state.players[session.playerId].name,
        };
        try {
          localStorage.setItem('rbb.multiplayer.v1', JSON.stringify(this.ui.joinDefaults));
        } catch {}
        await this.attach(session);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Connection failed.';
    } finally {
      this.connecting = false;
      button.disabled = false;
    }
  }

  private interact(): void {
    if (!this.session || !this.player() || this.player()!.cooldown > 0) return;
    if (this.buildKind && this.candidate)
      this.session.command({
        type: 'build',
        kind: this.buildKind,
        x: this.candidate.x,
        z: this.candidate.z,
        rotation: this.rotation,
      });
    else if (this.target) {
      this.session.command({ type: 'interact', target: this.target.id });
      this.renderer.swingTool();
    } else this.renderer.swingTool();
    this.lastAction = performance.now();
  }
  private consume(): void {
    const p = this.player();
    if (!p) return;
    this.session!.command({
      type: 'consume',
      item: isConsumable(p.equipped) ? p.equipped : 'berries',
    });
  }
  private cancelBuild(): void {
    this.buildKind = null;
    this.candidate = null;
    this.renderer.showPreview(null, false);
    this.ui.buildHint(null, '', false);
  }

  private save(): void {
    if (this.session?.mode !== 'solo') return;
    try {
      this.saved = this.saves.save(this.session.state, this.session.playerId);
      this.ui.setStatus('✓ Saved on this device');
    } catch {
      this.ui.setStatus('Save unavailable · export from pause menu');
      this.ui.toast(
        'Your browser could not save. Export your expedition from the pause menu before leaving.',
        true,
      );
    }
  }
  private download(text: string, filename?: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `rbb-expedition-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  private async importFile(file?: File): Promise<void> {
    if (!file) return;
    try {
      if (file.size > MAX_SAVE_BYTES) throw new Error('Save files must be smaller than 2 MB.');
      const raw = await file.text();
      const save = parseSave(raw);
      // A valid import deliberately replaces this device's active solo expedition; keep a backup.
      this.saves.import(raw);
      this.saved = save;
      await this.attach(new LocalSession(save.state.seed, save.state, save.playerId));
      this.ui.toast('Expedition imported. Welcome back.');
    } catch (error) {
      this.ui.toast(error instanceof Error ? error.message : 'Could not read that save.', true);
    }
  }

  private frame(time: number): void {
    if (this.disposed) return;
    const dt = this.previousFrame ? Math.min((time - this.previousFrame) / 1000, 0.1) : 1 / 60;
    this.previousFrame = time;
    const session = this.session;
    if (session) {
      const paused =
        !!this.ui.panel &&
        (this.ui.panel !== 'developer' || (session.mode === 'solo' && this.developer.paused));
      session.command({ type: 'move', input: this.input.sample(this.player()?.dev.flight) });
      session.update(dt, paused);
      const p = this.player()!;
      if (p.health <= 0 && this.ui.panel !== 'death' && this.ui.panel !== 'developer')
        this.openPanel('death');
      if (p.health > 0 && this.ui.panel === 'death') this.resume();
      if (session.state.tick !== this.syncedTick) {
        this.renderer.sync(getSnapshot(session));
        this.syncedTick = session.state.tick;
      }
      this.renderer.render(time, p, this.input.yaw, this.input.pitch, !this.ui.panel);
      this.audio.environment(
        this.renderer.atmosphere.last.weather.wind * session.state.tuning.windStrength,
        this.renderer.atmosphere.last.weather.rain,
        this.renderer.atmosphere.flash,
        !document.hidden && !paused,
      );
      this.target = this.buildKind || paused ? null : this.renderer.findTarget(session.state, p);
      if (this.buildKind && !paused) {
        // A short, explicit reach makes placement usable with mouse, keyboard and touch.
        const distance = 5 + Math.max(0, this.input.pitch) * 2;
        this.candidate = buildCandidate(
          session.state,
          session.world,
          this.buildKind,
          p.position.x - Math.sin(this.input.yaw) * distance,
          p.position.z - Math.cos(this.input.yaw) * distance,
          this.rotation,
        );
        const result = validateBuild(session.state, session.world, p, this.candidate);
        this.renderer.showPreview(this.candidate, result.ok);
        this.ui.buildHint(this.buildKind, result.message, result.ok);
      } else this.renderer.showPreview(null, false);
      // Holding the action key repeats gathering; building placement stays one piece per press.
      if (this.input.heldAction && !this.buildKind && time - this.lastAction > 610 && !paused)
        this.interact();
      this.uiTime += dt;
      this.saveTime += paused ? 0 : dt;
      if (this.uiTime > 0.1) {
        this.ui.update(
          session.state,
          p,
          session.world,
          this.input.yaw,
          this.target,
          session.mode,
          `${session.status} · ${session.ping} ms`,
        );
        if (this.ui.panel === 'developer') this.developer.update();
        this.uiTime = 0;
        if (session.mode === 'online') this.ui.setStatus(`${session.status} · ${session.ping} ms`);
      }
      if (this.saveTime >= 10) {
        this.saveTime = 0;
        this.save();
      }
    } else this.renderer.render(time, null, 0, 0, false);
    const stats = this.ui.root.querySelector<HTMLElement>('#stats')!;
    stats.hidden = !this.settings.showStats;
    if (this.settings.showStats) {
      const s = this.renderer.stats;
      stats.textContent = `${s.fps} FPS · ${s.quality} · ${s.pixelRatio.toFixed(2)}×\n${s.drawCalls} draws · ${Math.round(s.triangles / 1000)}k triangles\n${s.geometries} geometries${s.gpuMs === null ? '' : ` · GPU ${s.gpuMs.toFixed(2)} ms`}\n${session ? `${session.state.tick} ticks · ${session.mode}` : 'World preview'}`;
    }
    const renderingStatus = this.ui.root.querySelector('#rendering-status');
    if (renderingStatus) {
      const p = this.renderer.pipeline,
        gpu = this.renderer.stats.gpuMs;
      renderingStatus.textContent = `${p.passes.length ? p.passes.join(' → ') : 'Direct scene rendering'}. ${p.estimatedTargetMiB} MiB in shared scene, volume and history targets${gpu === null ? '' : ` · GPU ${gpu.toFixed(2)} ms`}.${p.probes ? ` Probes: ${p.probes.ready}/${p.probes.total}${p.probes.error ? ` (${p.probes.error})` : ''}.` : ''}${p.visibility.chunks ? ` Visibility: ${p.visibility.occluded} hidden · ${p.visibility.evictions} buffer releases · ${p.visibility.reloads} reloads.` : ''}${p.fallback.length ? ` Suppressed by ${this.renderer.stats.quality === 'low' ? 'Low quality' : 'device capabilities'}: ${p.fallback.join(', ')}. Your preferences are retained.` : ''}${this.settings.graphics.gpuTiming && !p.capabilities.timerQueries ? ' GPU timer is unavailable on this device.' : ''}`;
    }
    this.request = requestAnimationFrame((t) => this.frame(t));
  }

  diagnostics(): unknown {
    const p = this.player();
    return structuredClone({
      version,
      environment: this.session?.state.environment,
      tuning: this.session?.state.tuning,
      animals: this.session?.state.animals,
      sandbox: this.session?.state.sandbox,
      celestial: this.renderer.atmosphere.last,
      devAllowed: this.session?.devAllowed,
      graphics: this.settings.graphics,
      effectiveGraphics: this.renderer.effectiveGraphics,
      pipeline: this.renderer.pipeline,
      renderer: this.renderer.stats,
      panel: this.ui.panel,
      mode: this.session?.mode,
      tick: this.session?.state.tick,
      player: p,
      players: this.session && p ? getSnapshot(this.session).players : [],
      remoteSurvivors: this.renderer.remoteSurvivors,
      look: { yaw: this.input.yaw, pitch: this.input.pitch },
      resources: p
        ? this.session!.world.resources.filter(
            (r) => Math.hypot(r.x - p.position.x, r.z - p.position.z) < 40,
          )
        : [],
      mutations: this.session?.state.resources,
      buildings: this.session?.state.buildings,
      target: this.target?.id,
      build: this.candidate,
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.request);
    this.abort.abort();
    this.save();
    this.session?.close();
    this.developer.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
