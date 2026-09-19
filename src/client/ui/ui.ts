import { version } from '../../../package.json';
import {
  BALANCE,
  BUILDINGS,
  BUILDING_IDS,
  ITEMS,
  MILESTONES,
  SITE_TYPES,
  WEAPONS,
} from '../../shared/content';
import type { BuildingKind, Inventory, ItemId } from '../../shared/content';
import { canAfford } from '../../shared/inventory';
import type { GameState, PlayerState } from '../../shared/state';
import { biomeAt, DEFAULT_SEED, WORLD_SIZE } from '../../shared/world';
import type { WorldDefinition } from '../../shared/world';
import { terrainFloor } from '../../shared/terrain';
import type { RenderSettings, Target } from '../render/renderer';
import { escapeHtml as esc, icon } from './icons';
import { graphicsMarkup } from './developer';
import { terrainToolsMarkup } from '../terrain-tools';
import { itemDetailsMarkup, suppliesMarkup } from './supplies';
import { packMarkup } from './pack';
import { structureMarkup } from './structures';

export type Panel =
  | 'terrain'
  | 'developer'
  | 'inventory'
  | 'item-details'
  | 'supplies'
  | 'structure'
  | 'build'
  | 'map'
  | 'pause'
  | 'settings'
  | 'guide'
  | 'online'
  | 'team'
  | 'death'
  | 'new';
export const HOTBAR: ItemId[] = ['rock', 'hatchet', 'pickaxe', 'berries', 'bandage'];

export class UI {
  readonly canvas: HTMLCanvasElement;
  readonly menu: HTMLElement;
  readonly hud: HTMLElement;
  readonly modal: HTMLElement;
  panel: Panel | null = null;
  terrainLevel = 8;
  selectedItem: ItemId | null = null;
  suppliesId: string | null = null;
  structureId: string | null = null;
  craftCategory = 'All';
  trackedSiteId: string | null = null;
  private currentState?: GameState;
  private currentWorld?: WorldDefinition;
  joinDefaults = {
    serverUrl: import.meta.env.VITE_SERVER_URL || 'ws://localhost:8787',
    name: 'Wanderer',
  };
  inviteUrl = '';
  onAction: (action: string, value?: string) => void = () => {};
  private modalBody: HTMLElement;
  private previousFocus: HTMLElement | null = null;
  private panelSignature = '';
  private mapBase?: HTMLCanvasElement;
  private mapSeed = '';
  private mapTerrainRevision = -1;
  private mapTerrain?: GameState['terrain'];
  private toastTimeout?: ReturnType<typeof setTimeout>;
  private renderSettings?: RenderSettings;
  private sessionMode = 'solo';

  constructor(readonly root: HTMLElement) {
    root.innerHTML = `
      <canvas id="world" aria-label="3D survival world. Use WASD to move, mouse or touch to look, and E to gather."></canvas>
      <div id="vignette"></div>
      <main id="main-menu" class="menu">
        <header class="brand"><span class="brand-symbol">${icon('mountain')}</span><strong>rbb<span class="brand-dot">.</span></strong><span class="tag">FRONTIER ALPHA <b>${version}</b></span></header>
        <section class="menu-content">
          <p class="eyebrow"><span class="status-dot"></span> THE QUIET FRONTIER</p>
          <h1>A little wild.<br>A world of <em>possibility.</em></h1>
          <p class="menu-description">An untamed island. The tools in your hands.<br>Find your footing, build a home, and make it yours.</p>
          <div class="start-controls">
            <button id="continue-button" class="button primary" data-action="continue" hidden>Continue expedition ${icon('arrow')}</button>
            <button id="start-button" class="button primary" data-action="start">Enter the frontier ${icon('arrow')}</button>
            <div class="seed-field"><label for="world-seed">WORLD SEED</label><input id="world-seed" maxlength="48" value="${DEFAULT_SEED}" spellcheck="false" aria-label="World seed"/><span>↗</span></div>
            <div class="menu-secondary"><button class="text-button" data-action="online">Join a world ${icon('arrow')}</button><button class="text-button" data-action="guide">Field guide ${icon('map')}</button></div>
          </div>
          <p id="menu-save" class="muted small">Solo expeditions save automatically on this device.</p>
        </section>
        <aside class="vista-label"><span class="eyebrow">01 / HAVEN ISLAND</span><span>Somewhere to begin.</span><div class="vista-line"></div><span class="small">PROCEDURAL WORLD · ENDLESS POTENTIAL</span></aside>
        <footer class="menu-footer"><span>${icon('compass')} EXPLORE. MAKE. SURVIVE.</span><button class="text-button" data-action="settings">${icon('settings')} Settings</button><a href="https://github.com/michaelcrosato/rbb" target="_blank" rel="noreferrer">Built in the open ↗</a></footer>
      </main>
      <div id="hud" hidden>
        <div class="hud-top"><div class="location"><span class="hud-brand">rbb.</span><div><strong id="biome">Haven meadow</strong><span id="world-detail">DAY 01 · SOLO EXPEDITION</span></div></div><div class="compass"><span id="heading">N</span><div class="compass-ticks">┊ · ┊ · ┃ · ┊ · ┊</div><small id="bearing">000°</small></div><div class="hud-actions"><button class="icon-button" aria-label="Terrain tools" title="Terrain tools (T)" data-action="terrain">${icon('pickaxe')}</button><button id="crew-button" class="icon-button" title="Crew & invite" aria-label="Crew and invite" data-action="team" hidden></button><button class="icon-button" title="Map (M)" aria-label="Map" data-action="map">${icon('map')}</button><button class="icon-button" title="Pack (Tab)" aria-label="Pack and crafting" data-action="inventory">${icon('bag')}</button><button class="icon-button" title="Pause (Esc)" aria-label="Pause" data-action="pause">${icon('settings')}</button></div></div>
        <aside id="journal" class="journal"><div class="eyebrow">YOUR FIRST FOOTPRINTS <span>↗</span></div><strong id="objective-title"></strong><p id="objective-description"></p><div class="objective-track"><span id="objective-progress"></span></div><span id="objective-count" class="small muted"></span></aside>
        <div class="crosshair" aria-hidden="true"><span></span><span></span></div>
        <div id="target" class="target" hidden><span class="key">E</span><div><strong id="target-name"></strong><small id="target-action"></small></div></div>
        <div id="terrain-hint" class="terrain-hint" hidden></div><div id="oxygen" hidden></div><div id="build-hint" class="build-hint" hidden></div>
        <div class="hud-bottom"><div class="vitals">${(['health', 'hunger', 'thirst', 'stamina'] as const).map((stat, i) => `<div class="vital ${stat}" aria-label="${stat}">${icon(['heart', 'food', 'water', 'bolt'][i])}<div class="vital-track"><span id="${stat}-bar"></span></div><b id="${stat}-value">100</b></div>`).join('')}</div><div class="hotbar">${HOTBAR.map((item, i) => `<button class="slot" data-action="slot" data-value="${i}" aria-label="Equip ${ITEMS[item].name}"><kbd>${i + 1}</kbd>${icon(ITEMS[item].icon)}<small id="slot-count-${i}"></small><span class="slot-label">${ITEMS[item].name}</span></button>`).join('')}<button class="slot build-slot" data-action="build" aria-label="Building menu"><kbd>6</kbd>${icon('foundation')}<span class="slot-label">Build</span></button></div><div class="hud-status"><span id="save-indicator"><span class="status-dot"></span> World ready</span><span id="coordinates"></span></div></div>
        <div id="weapon-status" class="weapon-status"></div><div id="destination" class="destination"></div>
        <div class="control-hints"><span><kbd>W A S D</kbd> move</span><span><kbd>E</kbd> use / attack</span><span><kbd>TAB</kbd> craft</span><span><kbd>B</kbd> build</span><span><kbd>F</kbd> use item</span></div>
        <div id="touch-controls"><div id="joystick" aria-label="Movement joystick"><span></span></div><div class="touch-actions"><button id="touch-sprint" class="touch-button" aria-label="Toggle sprint">${icon('bolt')}</button><button id="touch-dive" class="touch-button" aria-label="Hold to dive" hidden>↓</button><button id="touch-jump" class="touch-button" aria-label="Jump">↑</button><button class="touch-button touch-gather" data-action="interact" aria-label="Gather or place">${icon('hatchet')}<small>USE</small></button><button class="touch-button" data-action="consume" aria-label="Eat berries or use equipped item">${icon('berries')}</button><button class="touch-button" data-action="rotate" aria-label="Rotate building">↻</button></div></div>
      </div>
      <div id="modal" class="modal-backdrop" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><div class="panel-top"><span class="eyebrow">RBB / FIELD NOTES</span><button class="icon-button" data-action="close" aria-label="Close panel">${icon('close')}</button></div><div id="panel-body"></div></section></div>
      <div id="toast" role="status" aria-live="polite" hidden></div>
      <div id="stats" hidden></div>
      <div id="fatal" class="fatal" role="alert" hidden></div>
      <input id="import-file" type="file" accept=".json,application/json" hidden />
    `;
    this.canvas = root.querySelector('#world')!;
    this.menu = root.querySelector('#main-menu')!;
    this.hud = root.querySelector('#hud')!;
    this.modal = root.querySelector('#modal')!;
    this.modalBody = root.querySelector('#panel-body')!;
    const touchActionSelector =
      '.hud-actions [data-action], .hotbar [data-action], .touch-actions [data-action]';
    root.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      // Touch HUD actions run on pointer release. Avoid a second action when the
      // browser also synthesizes a click; mouse and keyboard keep native clicks.
      if (e.pointerType === 'touch' && button?.matches(touchActionSelector)) return;
      if (button && !(button as HTMLButtonElement).disabled)
        this.onAction(button.dataset.action!, button.dataset.value);
    });
    // A look gesture can suppress the next compatibility click on mobile. Use
    // real pointer events for these game controls, with cancel/drag-out handling.
    const touchPresses = new Map<number, HTMLElement>();
    root.addEventListener('pointerdown', (event) => {
      const button = (event.target as Element).closest<HTMLElement>(touchActionSelector);
      if (event.pointerType !== 'touch' || !button) return;
      event.preventDefault();
      touchPresses.set(event.pointerId, button);
      button.setPointerCapture(event.pointerId);
    });
    root.addEventListener('pointerup', (event) => {
      const button = touchPresses.get(event.pointerId);
      touchPresses.delete(event.pointerId);
      if (!button || (button as HTMLButtonElement).disabled) return;
      const bounds = button.getBoundingClientRect();
      if (
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      )
        this.onAction(button.dataset.action!, button.dataset.value);
    });
    root.addEventListener('pointercancel', (event) => touchPresses.delete(event.pointerId));
    this.modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const nodes = [
        ...this.modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not([hidden]), select, a[href]',
        ),
      ];
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    });
  }

  setHasSave(hasSave: boolean, description?: string): void {
    this.root.querySelector<HTMLElement>('#continue-button')!.hidden = !hasSave;
    const start = this.root.querySelector<HTMLElement>('#start-button')!;
    start.className = hasSave ? 'button secondary' : 'button primary';
    start.innerHTML = `${hasSave ? 'New expedition' : 'Enter the frontier'} ${icon('arrow')}`;
    if (description) this.root.querySelector('#menu-save')!.textContent = description;
  }

  showGame(show: boolean): void {
    this.menu.hidden = show;
    this.hud.hidden = !show;
    this.root.classList.toggle('playing', show);
  }
  setStatus(message: string): void {
    this.root.querySelector('#save-indicator')!.textContent = message;
  }
  toast(message: string, error = false): void {
    if (!message) return;
    const toast = this.root.querySelector<HTMLElement>('#toast')!;
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.hidden = false;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(
      () => {
        toast.hidden = true;
      },
      error ? 5000 : 2800,
    );
  }
  fatal(message: string): void {
    const fatal = this.root.querySelector<HTMLElement>('#fatal')!;
    fatal.innerHTML = `<span class="eyebrow">THE FRONTIER IS TAKING A BREATHER</span><h1>Unable to render the world.</h1><p>${esc(message)}</p><button class="button primary" data-action="reload">Reload game ${icon('arrow')}</button>`;
    fatal.hidden = false;
  }

  update(
    state: GameState,
    player: PlayerState,
    world: WorldDefinition,
    yaw: number,
    target: Target | null,
    mode: string,
    connectionStatus = '',
  ): void {
    this.currentState = state;
    this.currentWorld = world;
    this.sessionMode = mode;
    const crew = this.root.querySelector<HTMLButtonElement>('#crew-button')!;
    crew.hidden = mode !== 'online';
    crew.textContent = connectionStatus.startsWith('Connected')
      ? `${Object.keys(state.players).length}/${BALANCE.maxPlayers}`
      : '…';
    if (this.panel === 'team') this.updateTeam(state, player, connectionStatus);
    const oxygen = this.root.querySelector<HTMLElement>('#oxygen')!;
    oxygen.hidden = player.oxygen >= 100 && player.position.y >= -1.5;
    oxygen.textContent = `AIR ${Math.round(player.oxygen)}% · ${matchMedia('(pointer: coarse)').matches ? 'Release dive' : 'Release C'} to surface`;
    this.root.querySelector<HTMLElement>('#touch-dive')!.hidden =
      player.position.y >= 0 && !player.dev.flight;
    this.root.querySelector('#biome')!.textContent = biomeAt(
      player.position.x,
      player.position.z,
      world.hash,
    );
    this.root.querySelector('#world-detail')!.textContent =
      `DAY ${String(Math.floor(state.environment.hours / 24) + 1).padStart(2, '0')} · ${state.sandbox ? 'SANDBOX · ' : ''}${Math.floor(
        state.environment.hours % 24,
      )
        .toString()
        .padStart(2, '0')}:${Math.floor((state.environment.hours % 1) * 60)
        .toString()
        .padStart(
          2,
          '0',
        )} · ${state.environment.weather.toUpperCase()} · ${mode === 'solo' ? 'SOLO' : 'SHARED'}`;
    const bearing = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
    this.root.querySelector('#heading')!.textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
      Math.round(bearing / 45) % 8
    ];
    this.root.querySelector('#bearing')!.textContent =
      `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
    this.root.querySelector('#coordinates')!.textContent =
      `${Math.round(player.position.x)} E / ${Math.round(-player.position.z)} N`;
    for (const stat of ['health', 'hunger', 'thirst', 'stamina'] as const) {
      this.root.querySelector(`#${stat}-value`)!.textContent = String(Math.ceil(player[stat]));
      this.root.querySelector<HTMLElement>(`#${stat}-bar`)!.style.width = `${player[stat]}%`;
    }
    player.quickSlots.forEach((item, i) => {
      const slot = this.root.querySelector(`#slot-count-${i}`)!.closest<HTMLElement>('.slot')!;
      if (slot.dataset.item !== item) {
        slot.dataset.item = item;
        slot.setAttribute('aria-label', `Equip ${ITEMS[item].name}`);
        slot.querySelector('.icon')!.outerHTML = icon(ITEMS[item].icon);
        slot.querySelector('.slot-label')!.textContent = ITEMS[item].name;
      }
      this.root.querySelector(`#slot-count-${i}`)!.textContent = player.inventory[item]
        ? String(player.inventory[item])
        : '—';
      this.root
        .querySelector(`#slot-count-${i}`)!
        .closest('.slot')!
        .classList.toggle('selected', player.equipped === item);
      this.root
        .querySelector(`#slot-count-${i}`)!
        .closest('.slot')!
        .classList.toggle('empty', !player.inventory[item]);
    });
    const weapon = WEAPONS[player.equipped];
    this.root.querySelector<HTMLElement>('#weapon-status')!.textContent =
      player.inventory[player.equipped] && weapon?.ammo
        ? `${ITEMS[player.equipped].name} · ${player.inventory[weapon.ammo] ?? 0} ${ITEMS[weapon.ammo].name.toLowerCase()}`
        : '';
    const destination = world.sites.find(
      (site) => site.id === this.trackedSiteId && !state.sites[site.id]?.disabled,
    );
    const direction = destination
      ? ((Math.atan2(destination.x - player.position.x, player.position.z - destination.z) * 180) /
          Math.PI +
          360) %
        360
      : 0;
    this.root.querySelector<HTMLElement>('#destination')!.textContent = destination
      ? `${SITE_TYPES[destination.kind].name} · ${Math.round(Math.hypot(destination.x - player.position.x, destination.z - player.position.z))} m · ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(direction / 45) % 8]}`
      : '';
    const objective = MILESTONES.find((m) => player.milestones[m.id] < m.target);
    this.root.querySelector('#objective-title')!.textContent =
      objective?.label ?? 'The island is yours to explore';
    this.root.querySelector('#objective-description')!.textContent =
      objective?.description ?? 'Keep building. Follow the coast. Make your next story.';
    this.root.querySelector<HTMLElement>('#objective-progress')!.style.width =
      `${objective ? Math.min(100, (player.milestones[objective.id] / objective.target) * 100) : 100}%`;
    this.root.querySelector('#objective-count')!.textContent = objective
      ? `${Math.min(objective.target, player.milestones[objective.id])} / ${objective.target}`
      : 'FIRST FOOTPRINTS COMPLETE';
    this.root.querySelector<HTMLElement>('#target')!.hidden = !target || !!this.panel;
    if (target) {
      this.root.querySelector('#target-name')!.textContent = target.name;
      this.root.querySelector('#target-action')!.textContent = target.action;
    }
    if (
      ['inventory', 'build', 'item-details', 'supplies', 'structure'].includes(this.panel ?? '')
    ) {
      const signature = JSON.stringify([
        player.inventory,
        player.worn,
        player.quickSlots,
        state.buildings,
        this.panel === 'supplies' ? state.bags.find((bag) => bag.id === this.suppliesId) : null,
        this.panel === 'supplies' && this.suppliesId ? state.sites[this.suppliesId] : null,
      ]);
      if (signature !== this.panelSignature) {
        this.panelSignature = signature;
        const active = document.activeElement as HTMLElement;
        const action = active?.dataset.action,
          value = active?.dataset.value;
        const focusedId = active?.id;
        const quantities = [
          ...this.modal.querySelectorAll<HTMLInputElement>('[data-preserve]'),
        ].map((input) => [input.id, input.value] as const);
        this.renderPanel(this.panel!, player);
        for (const [id, value] of quantities) {
          const input = this.modal.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
          if (input)
            input.value = String(
              Math.max(Number(input.min), Math.min(Number(input.max), Number(value))),
            );
        }
        if (focusedId) this.modal.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`)?.focus();
        if (action)
          this.modal
            .querySelector<HTMLElement>(
              `[data-action="${CSS.escape(action)}"]${value ? `[data-value="${CSS.escape(value)}"]` : ''}`,
            )
            ?.focus();
      }
    }
    if (this.panel === 'map') this.drawMap(world, state, player);
  }

  showPanel(
    panel: Panel,
    player?: PlayerState,
    settings?: RenderSettings,
    state?: GameState,
    world?: WorldDefinition,
  ): void {
    this.currentState = state ?? this.currentState;
    this.currentWorld = world ?? this.currentWorld;
    if (!this.panel) this.previousFocus = document.activeElement as HTMLElement;
    this.panel = panel;
    this.panelSignature = '';
    this.renderSettings = settings ?? this.renderSettings;
    this.modal.classList.toggle('developer-view', panel === 'developer');
    this.modal.hidden = false;
    this.menu.inert = true;
    this.hud.inert = true;
    this.renderPanel(panel, player);
    this.modal.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }
  hidePanel(): void {
    this.panel = null;
    this.modal.hidden = true;
    this.menu.inert = false;
    this.hud.inert = false;
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  updateTeam(state: GameState, player: PlayerState, status: string): void {
    const roster = this.modal.querySelector('#crew-list');
    if (!roster) return;
    const players = [player, ...Object.values(state.players).filter((p) => p.id !== player.id)];
    this.modal.querySelector('#crew-count')!.textContent =
      `${players.length} / ${BALANCE.maxPlayers} survivors`;
    this.modal.querySelector('#crew-status')!.textContent = status;
    roster.innerHTML = players
      .map((p) => {
        const detail =
          p.health <= 0
            ? 'Awaiting respawn'
            : p.id === player.id
              ? 'You'
              : `${Math.round(Math.hypot(p.position.x - player.position.x, p.position.z - player.position.z))} m away`;
        return `<li><span class="crew-avatar" aria-hidden="true">${esc(p.name.slice(0, 1))}</span><div><strong>${esc(p.name)}</strong><small>${detail}</small></div><span>${Math.ceil(p.health)} HP</span></li>`;
      })
      .join('');
  }

  private cost(cost: Inventory, inventory: Inventory): string {
    return Object.entries(cost)
      .map(
        ([item, count]) =>
          `<span class="cost ${(inventory[item as ItemId] ?? 0) >= count ? 'enough' : ''}">${icon(ITEMS[item as ItemId].icon)}${count} ${ITEMS[item as ItemId].name}</span>`,
      )
      .join('');
  }

  private renderPanel(panel: Panel, player?: PlayerState): void {
    let body: string;
    if (panel === 'developer') body = '<div id="developer-loading">Developer tools</div>';
    else if (panel === 'inventory' && player) {
      body = packMarkup(player, this.currentState!, this.currentWorld!, this.craftCategory);
    } else if (panel === 'item-details' && player) {
      body = itemDetailsMarkup(player, this.selectedItem);
    } else if (panel === 'supplies' && player) {
      const site = this.currentWorld?.sites.find((site) => site.id === this.suppliesId);
      body = site
        ? suppliesMarkup(
            player,
            this.currentState?.sites[site.id],
            SITE_TYPES[site.kind].name,
            `${SITE_TYPES[site.kind].description} Shared salvage; empty crates restock after ${SITE_TYPES[site.kind].restock / 60} world minutes from the first collection.`,
          )
        : suppliesMarkup(
            player,
            this.currentState?.bags.find((bag) => bag.id === this.suppliesId),
          );
    } else if (panel === 'structure' && player) {
      body = structureMarkup(
        player,
        this.currentState?.buildings.find((b) => b.id === this.structureId),
        this.currentState!,
      );
    } else if (panel === 'terrain' && player) {
      body = terrainToolsMarkup(this.terrainLevel, player.inventory.dirt ?? 0);
    } else if (panel === 'build' && player) {
      body = `<h2 id="panel-title">Put down roots.</h2><p class="panel-description">Choose a piece, find a clear spot, then place it. Press R to rotate.</p><div class="building-grid">${BUILDING_IDS.map((id) => `<button class="building-card" data-action="select-build" data-value="${id}"><span class="building-icon">${icon(BUILDINGS[id].icon)}</span><h3>${BUILDINGS[id].name}</h3><p>${BUILDINGS[id].description}</p><div class="costs">${this.cost(BUILDINGS[id].cost, player.inventory)}</div><span class="card-footer">${player.dev.freeBuild || canAfford(player.inventory, BUILDINGS[id].cost) ? 'SELECT & PLACE' : 'PREVIEW · NEEDS MATERIALS'} ${icon('arrow')}</span></button>`).join('')}</div>`;
    } else if (panel === 'map') {
      body =
        '<h2 id="panel-title">Know your island.</h2><p class="panel-description">Follow a landmark for salvage, or a quarry for abundant building materials.</p><div class="map-wrap"><canvas id="island-map" width="512" height="512" aria-label="Island map with your location, landmarks, quarries, crew, springs, buildings and lost packs"></canvas><span class="map-north">N ↑</span></div><div class="map-legend"><span>▲ You</span><span>● Crew</span><span>◆ Camp</span><span>● Freshwater</span><span>✚ Lost pack</span></div><div id="site-directory" class="site-directory"></div><button class="text-button" data-action="track-site" data-value="">Clear destination</button>';
    } else if (panel === 'pause') {
      body = `<h2 id="panel-title">Take a breath.</h2><p class="panel-description">${this.sessionMode === 'solo' ? 'Your solo world is paused. Your progress is saved automatically.' : 'The shared world keeps moving. Find a safe place before stepping away.'}</p><div class="pause-buttons"><button class="button primary" data-action="resume">Return to the wild ${icon('arrow')}</button><button class="button secondary" data-action="inventory">Pack & crafting ${icon('bag')}</button><button class="button secondary" data-action="terrain">Terrain tools <kbd>T</kbd></button><button class="button secondary" data-action="settings">Settings ${icon('settings')}</button><button class="button secondary" data-action="developer">Developer tools <kbd>F2</kbd></button><button class="button secondary" data-action="guide">Field guide ${icon('map')}</button>${this.sessionMode === 'solo' ? '<button class="button secondary" data-action="export">Export save ↗</button>' : '<button class="button secondary" data-action="team">Crew & invite ↗</button>'}<button class="text-button" data-action="menu">${this.sessionMode === 'solo' ? 'Save & return to menu' : 'Leave world & return to menu'}</button></div>`;
    } else if (panel === 'settings') {
      const s = this.renderSettings!;
      body = `<h2 id="panel-title">Your kind of frontier.</h2><p class="panel-description">Tune the experience to your device.</p><div class="settings-form"><label for="quality">Graphics quality <small>Auto adjusts resolution when frames slow down.</small></label><select id="quality"><option value="auto">Auto · recommended</option><option value="high">High · desktop</option><option value="balanced">Balanced</option><option value="mobile">Mobile · efficient</option><option value="low">Low · older hardware</option></select><label for="fov">Field of view <output id="fov-output">${s.fov}°</output></label><input id="fov" type="range" min="55" max="100" value="${s.fov}"/><label for="sensitivity">Look sensitivity <output id="sensitivity-output">${s.sensitivity.toFixed(1)}</output></label><input id="sensitivity" type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}"/><label for="volume">Sound effects <output id="volume-output">${Math.round(s.volume * 100)}%</output></label><input id="volume" type="range" min="0" max="1" step="0.05" value="${s.volume}"/><label class="checkbox-label"><input id="show-stats" type="checkbox" ${s.showStats ? 'checked' : ''}/> Show performance overlay</label><details class="graphics-options"><summary>Rendering effects</summary>${graphicsMarkup(s.graphics)}<button class="button secondary" id="enhanced-effects" type="button">Enable enhanced effects</button></details><button class="button primary" data-action="apply-settings">Apply settings ${icon('check')}</button></div>`;
    } else if (panel === 'online') {
      body = `<h2 id="panel-title">Better with company.</h2><p class="panel-description">One island. Up to ${BALANCE.maxPlayers} players. Gather, build and survive together.</p><div class="settings-form"><label for="survivor-name">Survivor name</label><input id="survivor-name" value="${esc(this.joinDefaults.name)}" maxlength="24" autocomplete="nickname"/><label for="server-url">World server</label><input id="server-url" value="${esc(this.joinDefaults.serverUrl)}" placeholder="wss://your-world.example.com" spellcheck="false"/><p class="muted small">Join the same running world server as your friends. Your survivor and camp are saved there. <a href="https://github.com/michaelcrosato/rbb/blob/main/docs/deployment.md" target="_blank" rel="noreferrer">Hosting guide ↗</a></p><label class="checkbox-label"><input id="fresh-survivor" type="checkbox"/> Start a new survivor (becomes this browser’s default; other open tabs keep their survivors)</label><button class="button primary" data-action="connect">Join world ${icon('arrow')}</button><p id="connect-status" class="small" role="status"></p></div>`;
    } else if (panel === 'team') {
      body = `<h2 id="panel-title">Your crew.</h2><p class="panel-description">A shared home in the wild. Find each other on the map.</p><div class="section-label" id="crew-count"></div><ul id="crew-list" class="crew-list" aria-label="Connected survivors"></ul><p id="crew-status" class="small" role="status"></p><div class="settings-form"><label for="world-invite">Invite friends</label><input id="world-invite" readonly value="${esc(this.inviteUrl)}"/><button class="button secondary" data-action="copy-invite">Copy invite link ↗</button><p class="muted small">Friends need access to the game and world server at these addresses. For LAN play, use the host’s LAN address in place of localhost.</p><button class="button primary" data-action="map">Find your crew ${icon('map')}</button></div>`;
    } else if (panel === 'death') {
      body =
        '<h2 id="panel-title">The wild leaves a mark.</h2><p class="panel-description">Your supplies remain where you fell for 30 world minutes. Return to your bedroll, or begin again in Haven meadow.</p><button class="button primary" data-action="respawn">Find your feet again ' +
        icon('arrow') +
        '</button>';
    } else if (panel === 'new') {
      body =
        '<h2 id="panel-title">A new beginning.</h2><p class="panel-description">Starting a new expedition replaces the solo save on this device. Export it first if you want to return to this world.</p><div class="pause-buttons"><button class="button secondary" data-action="export-existing">Export current expedition ↗</button><button class="button primary" data-action="new-confirmed">Start new expedition ' +
        icon('arrow') +
        '</button><button class="text-button" data-action="close">Keep my current expedition</button></div>';
    } else {
      body = `<h2 id="panel-title">Leave your first footprints.</h2><p class="panel-description">A few things to know before the island becomes home.</p><div class="guide-grid"><article><span>01</span><h3>Explore & gather</h3><p>WASD to walk, Shift to sprint, Space to jump. In water, hold C to dive and release to surface; watch your air. Move close, aim at a resource, then press E or hold the left mouse button. On touch, use the left stick and drag the world to look.</p></article><article><span>02</span><h3>Make your tools</h3><p>Tab opens your pack. A hatchet gathers wood faster; a pickaxe helps with stone. Collect wild flax for fiber. Use Details / drop to split supplies or assign quick slots 1–5. Nearby survivors can collect dropped items. F eats or heals.</p></article><article><span>03</span><h3>Shape terrain & make camp</h3><p>T opens terrain tools. Use a pickaxe to dig or flatten, and deposit excavated dirt to build ground up. Aim into a hillside to excavate a cave. B opens the building menu. A green preview marks a valid spot. E or left click places it. R rotates; B cancels. Walls snap to foundations and upper floors. Combine doorways, doors, windows, stairs, stairwell floors and roofs. Aim at built pieces and use E to repair, upgrade, open doors or share chest supplies. A bedroll sets respawn.</p></article><article><span>04</span><h3>Stay a little longer</h3><p>Eat berries and drink at the stone-ringed freshwater spring. Boars defend their territory. Cook meat beside a campfire, and rest nearby to heal. M opens the map: track abandoned camps, depots, lookouts and rich quarries. Smelt ore in a furnace; craft advanced equipment and ammunition beside a workbench. Wear a vest or trail pack from your inventory. Aim bows or firearms at wildlife and use E / Use to shoot; each shot spends ammunition. Esc pauses.</p></article></div><div class="guide-footer"><span class="muted small">Solo saves every 10 seconds and when you pause. Online worlds keep running while you look through your pack.</span><button class="button secondary" data-action="import">Import solo save ↗</button></div>`;
    }
    this.modalBody.innerHTML = body;
    this.modal
      .querySelector('.panel')!
      .classList.toggle('wide', ['inventory', 'build', 'guide', 'structure'].includes(panel));
    if (panel === 'settings') {
      this.modal.querySelector('#enhanced-effects')!.addEventListener('click', () => {
        for (const key of [
          'bloom',
          'ambientOcclusion',
          'sunShafts',
          'lensFlare',
          'planarReflections',
        ])
          this.modal.querySelector<HTMLInputElement>(`[data-graphics="${key}"]`)!.checked = true;
      });
      (this.modal.querySelector('#quality') as HTMLSelectElement).value =
        this.renderSettings!.quality;
      for (const id of ['fov', 'sensitivity', 'volume'])
        this.modal.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('input', (e) => {
          const value = Number((e.target as HTMLInputElement).value);
          this.modal.querySelector(`#${id}-output`)!.textContent =
            id === 'fov'
              ? `${value}°`
              : id === 'volume'
                ? `${Math.round(value * 100)}%`
                : value.toFixed(1);
        });
    }
  }

  buildHint(kind: BuildingKind | null, message: string, valid: boolean): void {
    const element = this.root.querySelector<HTMLElement>('#build-hint')!;
    element.hidden = !kind;
    if (kind) {
      element.classList.toggle('invalid', !valid);
      element.innerHTML = `<strong>${esc(BUILDINGS[kind].name)}</strong><span>${esc(message)}</span><small><kbd>E</kbd> place <kbd>R</kbd> rotate <kbd>B</kbd> cancel</small>`;
    }
  }

  drawMap(world: WorldDefinition, state: GameState, player: PlayerState): void {
    const canvas = this.modal.querySelector<HTMLCanvasElement>('#island-map');
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (
      !this.mapBase ||
      this.mapSeed !== world.seed ||
      this.mapTerrain !== state.terrain ||
      this.mapTerrainRevision !== state.terrain.revision
    ) {
      this.mapSeed = world.seed;
      this.mapTerrain = state.terrain;
      this.mapTerrainRevision = state.terrain.revision;
      this.mapBase = document.createElement('canvas');
      this.mapBase.width = 256;
      this.mapBase.height = 256;
      const base = this.mapBase.getContext('2d')!;
      for (let x = 0; x < 256; x++)
        for (let z = 0; z < 256; z++) {
          const h = terrainFloor(
            state.terrain,
            world,
            (x / 256) * WORLD_SIZE - 320,
            (z / 256) * WORLD_SIZE - 320,
          );
          base.fillStyle =
            h < 0
              ? '#3d686a'
              : h < 4
                ? '#cfbf97'
                : h < 18
                  ? '#a2ad7d'
                  : h < 32
                    ? '#7e926e'
                    : '#adada0';
          base.fillRect(x, z, 1, 1);
        }
    }
    ctx.drawImage(this.mapBase, 0, 0, 512, 512);
    ctx.strokeStyle = '#e8e4c51c';
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    const at = (x: number) => ((x + 320) / WORLD_SIZE) * 512;
    const sites = world.sites.filter((site) => !state.sites[site.id]?.disabled);
    const directory = this.modal.querySelector('#site-directory');
    if (directory && !directory.children.length)
      directory.innerHTML = sites
        .map(
          (site, index) =>
            `<button class="site-card" data-action="track-site" data-value="${site.id}"><strong>${index + 1} · ${SITE_TYPES[site.kind].name}</strong><span>${SITE_TYPES[site.kind].description}</span><small>${Math.round(Math.hypot(site.x - player.position.x, site.z - player.position.z))} m · Track destination →</small></button>`,
        )
        .join('');
    for (const [index, site] of sites.entries()) {
      ctx.fillStyle = SITE_TYPES[site.kind].color;
      ctx.strokeStyle = '#284c48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at(site.x), at(site.z), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#19372e';
      ctx.textAlign = 'center';
      ctx.fillText(String(index + 1), at(site.x), at(site.z) + 4);
    }
    ctx.textAlign = 'left';
    for (const r of world.resources)
      if (r.kind === 'spring') {
        ctx.fillStyle = '#d0fcfb';
        ctx.beginPath();
        ctx.arc(at(r.x), at(r.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    for (const b of state.buildings) {
      ctx.fillStyle = '#fff0be';
      ctx.fillRect(at(b.x) - 2, at(b.z) - 2, 4, 4);
    }
    for (const b of state.bags)
      if (b.owner === player.id) {
        ctx.fillStyle = '#ffd1b2';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('+', at(b.x), at(b.z));
      }
    ctx.fillStyle = '#f3efd5';
    ctx.font = '10px monospace';
    ctx.fillText('HAVEN MEADOW', 248, 348);
    const labels = [{ x: 248, y: 348, width: ctx.measureText('HAVEN MEADOW').width }];
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    for (const p of Object.values(state.players)) {
      if (p.id === player.id) continue;
      const x = at(p.position.x),
        z = at(p.position.z);
      ctx.fillStyle = p.health > 0 ? '#bee499' : '#ffd1b2';
      ctx.strokeStyle = '#284c48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, z, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const width = ctx.measureText(p.name).width;
      const labelX = Math.max(
        4,
        Math.min(508 - width, x + width + 9 > 508 ? x - width - 9 : x + 9),
      );
      // Three nearby teammates should each have a readable label, including at spawn.
      const candidates = [-10, 8, -28, 26, -46, 44].map((offset) =>
        Math.max(16, Math.min(500, z + offset)),
      );
      const labelY =
        candidates.find((y) =>
          labels.every(
            (label) =>
              Math.abs(y - label.y) >= 16 ||
              labelX > label.x + label.width + 4 ||
              labelX + width + 4 < label.x,
          ),
        ) ?? candidates[0];
      labels.push({ x: labelX, y: labelY, width });
      ctx.lineWidth = 3;
      ctx.strokeText(p.name, labelX, labelY);
      ctx.fillText(p.name, labelX, labelY);
    }
    ctx.textAlign = 'left';
    ctx.save();
    ctx.translate(at(player.position.x), at(player.position.z));
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#284c48';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
