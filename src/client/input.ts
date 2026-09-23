import { clamp } from '../shared/math';
import type { MoveInput } from '../shared/state';

export type InputAction =
  | 'terrain'
  | 'developer'
  | 'interact'
  | 'inventory'
  | 'build'
  | 'map'
  | 'pause'
  | 'rotate'
  | 'consume'
  | 'slot';
export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  active = false;
  heldAction = false;
  private keys = new Set<string>();
  private jump = false;
  private stick = { x: 0, y: 0 };
  private touchSprint = false;
  private touchDive = false;
  private touchJump = false;
  private readonly abort = new AbortController();
  private lookPointer: { id: number; x: number; y: number } | null = null;
  private sprintButton: HTMLElement | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly action: (action: InputAction, value?: number) => void,
  ) {
    const signal = this.abort.signal;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'F2') {
          e.preventDefault();
          this.action('developer');
          return;
        }
        if (e.code === 'Escape') {
          this.action('pause');
          return;
        }
        if ((e.target as HTMLElement)?.matches('input, select, textarea')) return;
        if (e.code === 'Tab' && !this.active) return;
        // Menus keep native Space activation and arrow-key scrolling.
        if (
          this.active &&
          ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
        )
          e.preventDefault();
        this.keys.add(e.code);
        if (e.repeat) return;
        if (!this.active && !['Tab', 'KeyI', 'KeyB', 'KeyM', 'KeyT'].includes(e.code)) return;
        if (e.code === 'Space') this.jump = true;
        const actions: Record<string, InputAction> = {
          KeyE: 'interact',
          KeyI: 'inventory',
          Tab: 'inventory',
          KeyB: 'build',
          KeyT: 'terrain',
          KeyM: 'map',
          KeyR: 'rotate',
          KeyF: 'consume',
        };
        if (actions[e.code]) this.action(actions[e.code]);
        if (/^Digit[1-6]$/.test(e.code)) this.action('slot', Number(e.code.slice(-1)) - 1);
      },
      { signal },
    );
    window.addEventListener('keyup', (e) => this.keys.delete(e.code), { signal });
    window.addEventListener('blur', () => this.reset(), { signal });
    document.addEventListener(
      'mousemove',
      (e) => {
        if (document.pointerLockElement === canvas && this.active)
          this.look(e.movementX, e.movementY);
      },
      { signal },
    );
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.active) return;
        if (e.pointerType === 'touch' || document.pointerLockElement !== canvas) {
          this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
          canvas.setPointerCapture(e.pointerId);
        } else if (e.button === 0) {
          this.heldAction = true;
          this.action('interact');
        }
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (this.lookPointer?.id === e.pointerId && this.active) {
          this.look(
            e.clientX - this.lookPointer.x,
            e.clientY - this.lookPointer.y,
            e.pointerType === 'touch' ? 1.8 : 1,
          );
          this.lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }
      },
      { signal },
    );
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') this.heldAction = false;
      if (this.lookPointer?.id === e.pointerId) this.lookPointer = null;
    };
    window.addEventListener('pointerup', release, { signal });
    window.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }

  bindTouch(root: HTMLElement): void {
    const dive = root.querySelector<HTMLButtonElement>('#touch-dive');
    dive?.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.touchDive = true;
        dive.setPointerCapture(e.pointerId);
      },
      { signal: this.abort.signal },
    );
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      dive?.addEventListener(
        event,
        () => {
          this.touchDive = false;
        },
        { signal: this.abort.signal },
      );
    const stick = root.querySelector<HTMLElement>('#joystick')!,
      knob = stick.querySelector<HTMLElement>('span')!;
    let pointer: number | null = null;
    const update = (e: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      let x = e.clientX - rect.left - rect.width / 2,
        y = e.clientY - rect.top - rect.height / 2;
      const dist = Math.hypot(x, y);
      if (dist > 38) {
        x *= 38 / dist;
        y *= 38 / dist;
      }
      this.stick = { x: x / 38, y: y / 38 };
      knob.style.transform = `translate(${x}px, ${y}px)`;
    };
    stick.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        pointer = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        update(e);
      },
      { signal: this.abort.signal },
    );
    stick.addEventListener(
      'pointermove',
      (e) => {
        if (pointer === e.pointerId) update(e);
      },
      { signal: this.abort.signal },
    );
    const release = () => {
      pointer = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release, { signal: this.abort.signal });
    stick.addEventListener('pointercancel', release, { signal: this.abort.signal });
    const jumpButton = root.querySelector<HTMLElement>('#touch-jump')!;
    jumpButton.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.jump = true;
        this.touchJump = true;
        jumpButton.setPointerCapture(e.pointerId);
      },
      { signal: this.abort.signal },
    );
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      jumpButton.addEventListener(
        event,
        () => {
          this.touchJump = false;
        },
        { signal: this.abort.signal },
      );
    this.sprintButton = root.querySelector<HTMLElement>('#touch-sprint')!;
    this.sprintButton.addEventListener(
      'click',
      () => {
        this.touchSprint = !this.touchSprint;
        this.sprintButton?.classList.toggle('selected', this.touchSprint);
      },
      { signal: this.abort.signal },
    );
  }

  private look(dx: number, dy: number, multiplier = 1): void {
    this.yaw -= dx * 0.0022 * this.sensitivity * multiplier;
    this.yaw = ((((this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    this.pitch = clamp(this.pitch - dy * 0.0022 * this.sensitivity * multiplier, -1.45, 1.45);
  }

  sample(flying = false): MoveInput {
    const forward = this.active
      ? Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
        Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
        this.stick.y
      : 0;
    const strafe = this.active
      ? Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
        Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) +
        this.stick.x
      : 0;
    const input = {
      forward: clamp(forward, -1, 1),
      strafe: clamp(strafe, -1, 1),
      yaw: this.yaw,
      pitch: this.pitch,
      sprint:
        this.active &&
        (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint),
      jump: this.active && (flying ? this.keys.has('Space') || this.touchJump : this.jump),
      dive: this.active && (this.keys.has('KeyC') || this.touchDive),
    };
    this.jump = false;
    return input;
  }

  reset(): void {
    this.keys.clear();
    this.heldAction = false;
    this.jump = false;
    this.stick = { x: 0, y: 0 };
    this.lookPointer = null;
    this.touchSprint = false;
    // Menus clear held input; the sprint toggle must not stay highlighted while off.
    this.sprintButton?.classList.remove('selected');
    this.touchDive = false;
    this.touchJump = false;
  }
  dispose(): void {
    this.abort.abort();
  }
}
