import { BALANCE } from '../shared/content';
import type { Earthwork } from '../shared/earthworks';
import { terrainAim } from '../shared/earthworks';
import { terrainRaycast } from '../shared/terrain';
import type { TerrainBrush, TerrainHit } from '../shared/terrain';
import type { Session } from './session';
import type { WorldRenderer } from './render/renderer';
import type { UI } from './ui/ui';

export class TerrainControls {
  mode: Earthwork['mode'] | null = null;
  level = 8;
  developerBrush: TerrainBrush | null = null;
  hit: TerrainHit | null = null;
  private brush: TerrainBrush | null = null;
  constructor(
    private options: {
      session: () => Session | null;
      look: () => { yaw: number; pitch: number };
      renderer: WorldRenderer;
      ui: UI;
      sculpt: (brush: TerrainBrush) => void;
    },
  ) {}
  get active(): boolean {
    return !!this.mode || !!this.developerBrush;
  }
  cancel(): void {
    this.mode = null;
    this.developerBrush = null;
    this.brush = null;
    this.hit = null;
    this.options.renderer.showTerrainBrush(null);
    this.options.ui.root.querySelector<HTMLElement>('#terrain-hint')!.hidden = true;
  }
  sample(): void {
    if (!this.hit) return;
    this.level = Math.round(this.hit.point.y * 4) / 4;
    if (this.developerBrush) this.developerBrush.level = this.level;
    this.options.ui.toast(`Level sampled: ${this.level.toFixed(2)} m.`);
  }
  apply(): void {
    const session = this.options.session();
    if (!session) return;
    if (this.developerBrush && this.brush) this.options.sculpt(this.brush);
    else if (this.mode)
      session.command({ type: 'terrain', request: { mode: this.mode, level: this.level } });
    this.options.renderer.swingTool();
  }
  update(paused: boolean): void {
    const session = this.options.session();
    if (!session) return;
    const p = { ...session.state.players[session.playerId], ...this.options.look() };
    if (!this.active || paused) {
      this.options.renderer.showTerrainBrush(null);
      this.options.ui.root.querySelector<HTMLElement>('#terrain-hint')!.hidden = true;
      return;
    }
    const dev = this.developerBrush;
    this.hit = dev
      ? terrainRaycast(
          session.state.terrain,
          session.world,
          { x: p.position.x, y: p.position.y + BALANCE.eyeHeight, z: p.position.z },
          {
            x: -Math.sin(p.yaw) * Math.cos(p.pitch),
            y: Math.sin(p.pitch),
            z: -Math.cos(p.yaw) * Math.cos(p.pitch),
          },
          80,
        )
      : terrainAim(session.state, session.world, p);
    this.brush = null;
    if (this.hit) {
      const mode = dev?.mode ?? this.mode!;
      const offset = mode === 'add' ? 0.65 : mode === 'dig' ? -0.45 : 0;
      this.brush = {
        shape: 'sphere',
        radius: BALANCE.terrainRadius,
        strength: 1,
        level: this.level,
        ...dev,
        mode,
        x: this.hit.point.x + this.hit.normal.x * offset,
        y: this.hit.point.y + this.hit.normal.y * offset,
        z: this.hit.point.z + this.hit.normal.z * offset,
      };
    }
    this.options.renderer.showTerrainBrush(this.brush);
    const hint = this.options.ui.root.querySelector<HTMLElement>('#terrain-hint')!;
    hint.hidden = false;
    const name = dev?.mode ?? this.mode;
    hint.textContent = `${dev ? 'SCULPT' : 'TERRAIN'} · ${name?.toUpperCase()}${name === 'flatten' ? ` · ${this.level.toFixed(2)} m` : ''} · ${p.inventory.dirt ?? 0} dirt\n${this.hit ? 'E / Use to apply' : `Aim at ground within ${dev ? 80 : BALANCE.terrainReach} m`} · R / ↻ sample level · T tools`;
  }
}

export function terrainToolsMarkup(level: number, dirt: number): string {
  return `<h2 id="panel-title">Shape the ground.</h2><p class="panel-description">Excavate a pit, tunnel into a hillside, or make level ground for a camp. Digging collects dirt; depositing and filling consume it.</p>
  <div class="terrain-modes"><button class="building-card" data-action="terrain-select" data-value="dig"><h3>Dig terrain</h3><p>Excavate floors, walls and ceilings with your pickaxe.</p></button>
  <button class="building-card" data-action="terrain-select" data-value="add"><h3>Deposit dirt</h3><p>Build up banks, seal openings or raise a mound.</p></button>
  <button class="building-card" data-action="terrain-select" data-value="flatten"><h3>Flatten ground</h3><p>Cut and fill toward the chosen height with your pickaxe.</p></button></div>
  <label class="dev-field"><span>Level height (m)</span><input id="terrain-level" type="number" min="-62" max="126" step="0.25" value="${level.toFixed(2)}"><small>Aim at a surface and press R or ↻ to sample its height while working.</small></label>
  <p class="muted">${dirt} dirt in your pack. Dig and flatten require a stone pickaxe. Hold E or left click to work; touch uses the Use button.</p><button class="button secondary" data-action="terrain-stop">Put terrain tools away</button>`;
}
