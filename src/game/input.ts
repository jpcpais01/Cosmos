import type { FlightInput } from '../ship/flight';

/** Keyboard + mouse + touch input, sampled once per frame. */
export class Input {
  private keys = new Set<string>();
  private mdx = 0;
  private mdy = 0;
  /** drag deltas for free-look (when not pointer locked) */
  lookDX = 0;
  lookDY = 0;
  dragging = false;
  wheel = 0;
  pointerLocked = false;
  /** whether right-click may enter mouse flight right now (false while the map or a panel is open) */
  canLock: () => boolean = () => true;
  /** called when mouse flight starts or ends */
  onLockChange: (locked: boolean) => void = () => undefined;
  /** called when the browser refuses to capture the mouse */
  onLockError: () => void = () => undefined;
  /** virtual joystick from the touch UI, -1..1 */
  touchStick = { x: 0, y: 0 };
  touchThrottle: number | null = null;
  sensitivity = 0.0022;
  invertY = false;
  private pressed: string[] = [];

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.push(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.pointerLocked) this.dragging = true;
    });
    // right-click anywhere toggles mouse flight on and off; the browser menu never shows
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      this.toggleLock();
    });
    window.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault();
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      } else if (this.dragging) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === el;
      if (locked === this.pointerLocked) return;
      this.pointerLocked = locked;
      this.mdx = this.mdy = 0;
      this.dragging = false;
      this.onLockChange(locked);
    });
    document.addEventListener('pointerlockerror', () => this.onLockError());
    // touch free-look on the canvas
    let last: { x: number; y: number } | null = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!last || e.touches.length !== 1) return;
      const t = e.touches[0];
      this.lookDX += (t.clientX - last.x) * 1.5;
      this.lookDY += (t.clientY - last.y) * 1.5;
      last = { x: t.clientX, y: t.clientY };
      this.dragging = true;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      last = null;
      this.dragging = false;
    });
  }

  requestLock(): void {
    if (document.pointerLockElement === this.el || !this.canLock()) return;
    // newer browsers return a promise that rejects on failure; pointerlockerror reports it
    const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => undefined);
  }

  toggleLock(): void {
    // ask the document, not the flag: pointerlockchange can arrive a frame late
    if (document.pointerLockElement === this.el) document.exitPointerLock();
    else this.requestLock();
  }

  releaseLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Key codes pressed since the last call. */
  consumePressed(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }

  flight(): FlightInput {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const inv = this.invertY ? -1 : 1;
    const f: FlightInput = {
      pitch: (k('ArrowDown') - k('ArrowUp')) * 0.8 + this.touchStick.y * inv * 0.9,
      yaw: (k('KeyA') + k('ArrowLeft') - k('KeyD') - k('ArrowRight')) * 0.8 - this.touchStick.x * 0.9,
      roll: k('KeyQ') - k('KeyE'),
      mousePitch: -this.mdy * this.sensitivity * inv,
      mouseYaw: -this.mdx * this.sensitivity,
      mouseFlight: this.pointerLocked,
      throttleDelta: (k('KeyW') - k('KeyS')) * 0.45,
      boost: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      brake: this.keys.has('KeyX'),
    };
    this.mdx = this.mdy = 0;
    return f;
  }
}
