import { Vector3 } from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import type { WarpDrive, WarpTarget } from '../game/warp';
import { AU_KM, C_KMS, WARP_FACTORS, type WarpFactor } from '../sim/constants';
import { fmtDistance, fmtDuration } from './format';
import { bodyRgb, drawBody } from './bodyGlyph';
import { GATE, gatePosition } from '../game/gate';
import { SYSTEMS, SYSTEM_BY_ID, lightYearsBetween, type StarSystem } from '../sim/systems';
import { systemOf } from '../sim/bodies';
import { GalaxyMap } from './galaxy';

const FONT = "'Rajdhani', 'Segoe UI', system-ui, sans-serif";
const AMBER = 'rgba(255,179,71,0.95)';
const GATE_COLOR = 'rgba(190,160,255,0.95)';
/** Off-screen margin (px) kept when clipping orbit lines. */
const CLIP = 40;
const AU_RINGS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 40, 50];

const _a = new Vector3();
const _b = new Vector3();

interface Hit {
  state: BodyState;
  x: number;
  y: number;
  r: number;
}

/** Orbit polyline relative to the parent, as x/z pairs (km), with its radius range. */
interface Orbit {
  t: number;
  xz: Float64Array;
  rMin: number;
  rMax: number;
  stroke: string;
  strokeHi: string;
}

/** Result of the last clip(): the visible part of the segment, as fractions along it. */
let clipT0 = 0;
let clipT1 = 1;
function edge(p: number, q: number): boolean {
  if (p === 0) return q >= 0;
  const r = q / p;
  if (p < 0) {
    if (r > clipT1) return false;
    if (r > clipT0) clipT0 = r;
  } else {
    if (r < clipT0) return false;
    if (r < clipT1) clipT1 = r;
  }
  return true;
}
/** Liang-Barsky: clips a segment to the screen padded by CLIP; false when it misses it entirely. */
function clip(ax: number, ay: number, bx: number, by: number, W: number, H: number): boolean {
  const dx = bx - ax, dy = by - ay;
  clipT0 = 0;
  clipT1 = 1;
  return edge(-dx, ax + CLIP) && edge(dx, W + CLIP - ax) && edge(-dy, ay + CLIP) && edge(dy, H + CLIP - ay);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Top-down solar system map (ecliptic plane) for choosing warp destinations. */
export class SystemMap {
  readonly root = el('div', 'map overlay hidden');
  private canvas = el('canvas', 'map-canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private bg = document.createElement('canvas');
  private info = el('div', 'map-info panel');
  private list = el('div', 'map-list panel');
  private listButtons = new Map<string, HTMLButtonElement>();
  open = false;
  /** world km of the screen centre (x, z) */
  private center = new Vector3();
  private follow: string | null = 'sun';
  private title = el('div', 'map-title');
  /** system the body list was built for */
  private listSystem = '';
  private scale = 1; // px per km
  private targetScale = 1;
  private hits: Hit[] = [];
  private hitN = 0;
  private labels: number[] = [];
  private orbits = new Map<string, Orbit>();
  private selection: WarpTarget | null = null;
  private hover: BodyState | null = null;
  /** where the warp gate was drawn last frame (screen px) */
  private gateXY: [number, number] | null = null;
  private gateButton: HTMLButtonElement | null = null;
  /** the star system on show (another one than the ship's can be looked at, not flown to) */
  private view = 'sol';
  private bodies: BodyState[] = [];
  private mode: 'system' | 'galaxy' = 'system';
  readonly galaxy = new GalaxyMap();
  private modeBtn = el('button', 'btn map-mode', 'GALAXY');
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDist = 0;
  private pinch0 = 0;
  private dpr = 1;
  private W = 1;
  private H = 1;
  private lastTime = 0;
  private infoAge = 1;
  private distEl: HTMLElement | null = null;
  private chipEls: HTMLElement[] = [];
  private shown = new Map<HTMLElement, string>();
  onWarp?: (t: WarpTarget, factor: WarpFactor) => void;
  onSelect?: (t: WarpTarget) => void;
  onClose?: () => void;
  onFactor?: (f: WarpFactor) => void;

  constructor(private eph: Ephemeris, private ship: Ship, private warp: WarpDrive) {
    const top = el('div', 'map-top');
    top.append(this.title);
    const right = el('div', 'map-top-right');
    this.modeBtn.title = 'Switch between this star system and the galaxy';
    this.modeBtn.onclick = () => this.setMode(this.mode === 'system' ? 'galaxy' : 'system');
    right.append(this.modeBtn);
    const close = el('button', 'btn icon', '✕');
    close.title = 'Close map (M / Esc)';
    close.onclick = () => this.onClose?.();
    right.append(close);
    top.append(right);
    const hint = el('div', 'map-hint', 'Scroll or pinch to zoom · drag to pan · tap a body to select it, or empty space for coordinates');
    this.root.append(this.canvas, this.galaxy.root, top, this.list, this.info, hint);
    this.galaxy.onView = (id) => {
      this.view = id;
      this.setMode('system');
      this.buildList();
      this.focusBody(SYSTEM_BY_ID[id].star, false);
      this.selection = id === this.eph.system.id ? this.warp.target : null;
      this.renderInfo();
    };
    this.galaxy.onCourse = () => {
      this.view = this.eph.system.id;
      this.setMode('system');
      this.buildList();
      this.focusGate();
    };
    this.buildList();
    this.bindPointer();
  }

  /** Body list and title for the system the ship is in. */
  private buildList(): void {
    const sys = this.viewSys;
    this.listSystem = sys.id;
    this.bodies = this.eph.all.filter((b) => systemOf(b.def.id) === sys.id);
    this.setTitle();
    this.list.innerHTML = '';
    this.listButtons.clear();
    const star = this.star;
    const groups: BodyState[] = this.bodies.filter((s) => s === star || s.parent === star);
    const button = (s: BodyState, cls: string) => {
      const b = el('button', cls, s.def.name);
      b.style.setProperty('--dot', bodyRgb(s.def.color, 1.05));
      b.onclick = () => this.focusBody(s.def.id, true);
      this.listButtons.set(s.def.id, b);
      return b;
    };
    for (const g of groups) {
      const row = el('div', 'map-group');
      row.append(button(g, 'map-body'));
      if (g.children.length) {
        const kids = el('div', 'map-moons');
        for (const k of g.children) kids.append(button(k, 'map-moon'));
        row.append(kids);
      }
      this.list.append(row);
    }
    // the warp gate, out past the planets
    const g = el('button', 'map-body map-gate', 'Warp gate');
    g.style.setProperty('--dot', 'rgb(190,160,255)');
    g.onclick = () => this.focusGate();
    this.gateButton = g;
    const row = el('div', 'map-group');
    row.append(g);
    this.list.append(row);
  }

  private get viewSys(): StarSystem {
    return SYSTEM_BY_ID[this.view] ?? this.eph.system;
  }

  /** The star of the system on show. */
  private get star(): BodyState {
    return this.eph.get(this.viewSys.star);
  }

  /** Looking at another star system than the ship's (nothing there can be a warp target). */
  private get remote(): boolean {
    return this.view !== this.eph.system.id;
  }

  private setTitle(): void {
    if (this.mode === 'galaxy') {
      this.title.innerHTML = 'MILKY WAY <span>a model of the galaxy, the stars at their real positions</span>';
      return;
    }
    const sys = this.viewSys;
    const away = this.remote ? ` · ${Math.round(lightYearsBetween(this.eph.system, sys)).toLocaleString('en-US')} light years away` : '';
    this.title.innerHTML = `${sys.name.toUpperCase()} <span>true sizes and distances${away}</span>`;
  }

  private setMode(m: 'system' | 'galaxy'): void {
    this.mode = m;
    this.root.classList.toggle('mode-galaxy', m === 'galaxy');
    this.modeBtn.textContent = m === 'galaxy' ? 'STAR SYSTEM' : 'GALAXY';
    if (m === 'galaxy') this.galaxy.show(this.eph.system.id);
    this.setTitle();
  }

  /** Centres on the warp gate, with its star in view, and selects it. */
  focusGate(): void {
    const sys = this.viewSys;
    this.follow = null;
    gatePosition(this.eph, this.center, sys);
    const flat = Math.hypot(sys.gate.dir.x, sys.gate.dir.z) * sys.gate.distance;
    this.targetScale = (Math.min(this.W, this.H) * 0.4) / Math.max(flat * 0.35, AU_KM * 0.05);
    this.select({ kind: 'gate' });
  }

  /** Centres on a body and zooms so its moon system (or the body) fits. */
  focusBody(id: string, select: boolean): void {
    const s = this.eph.get(id);
    this.follow = id;
    this.center.copy(s.pos);
    let extent: number;
    if (s.def.kind === 'star') extent = Math.max(...s.children.map((c) => c.pos.length())) * 1.05;
    else if (s.children.length) extent = Math.max(...s.children.map((c) => c.pos.distanceTo(s.pos))) * 1.25;
    else extent = s.def.radius * 40;
    this.targetScale = (Math.min(this.W, this.H) * 0.45) / extent;
    if (select) this.select({ kind: 'body', id });
  }

  private select(t: WarpTarget): void {
    this.selection = t;
    // in another star system: shown, never a warp target
    if (!this.remote) this.onSelect?.(t);
    this.renderInfo();
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.view = this.eph.system.id;
    if (this.mode === 'galaxy') this.setMode('system');
    if (this.listSystem !== this.view) this.buildList();
    this.resize();
    // start centred on the ship's system
    const f = this.ship.frame;
    const sys = f.def.kind === 'moon' && f.parent ? f.parent : f;
    this.focusBody(sys.def.id, false);
    this.scale = this.targetScale;
    this.selection = this.warp.target;
    this.renderInfo();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr) || 1;
    this.canvas.height = Math.round(this.H * this.dpr) || 1;
    this.buildBackground();
    if (this.mode === 'galaxy') this.galaxy.resize();
  }

  /** Deep-space backdrop with faint dust, drawn once per resize and blitted every frame. */
  private buildBackground(): void {
    const { W, H, dpr } = this;
    const c = this.bg;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
    grad.addColorStop(0, '#07111d');
    grad.addColorStop(1, '#010308');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((W * H) / 2600);
    for (let i = 0; i < n; i++) {
      const a = rnd() * rnd() * 0.5 + 0.04;
      g.fillStyle = `rgba(200,220,255,${a.toFixed(3)})`;
      g.fillRect(rnd() * W, rnd() * H, 1, 1);
    }
  }

  private sx(x: number): number {
    return this.W / 2 + (x - this.center.x) * this.scale;
  }

  private sy(z: number): number {
    return this.H / 2 + (z - this.center.z) * this.scale;
  }

  private toWorld(x: number, y: number, out: Vector3): Vector3 {
    return out.set(this.center.x + (x - this.W / 2) / this.scale, 0, this.center.z + (y - this.H / 2) / this.scale);
  }

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-Math.sign(e.deltaY) * 0.25));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.dragDist = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        // hover highlight with a mouse
        if (e.pointerType === 'mouse') {
          this.hover = this.pick(e.offsetX, e.offsetY)?.state ?? null;
          c.style.cursor = this.hover ? 'pointer' : '';
        }
        return;
      }
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      if (this.pointers.size === 1) {
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        if (this.dragDist > 4) {
          this.follow = null;
          this.center.x -= dx / this.scale;
          this.center.z -= dy / this.scale;
          c.style.cursor = 'grabbing';
        }
      }
      p.x = e.offsetX;
      p.y = e.offsetY;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch0);
        this.pinch0 = d;
        this.dragDist = 99;
      }
    });
    const up = (e: PointerEvent) => {
      const had = this.pointers.delete(e.pointerId);
      c.style.cursor = '';
      if (had && this.pointers.size === 0 && this.dragDist <= 4) this.click(e.offsetX, e.offsetY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('pointerleave', () => (this.hover = null));
    c.addEventListener('dblclick', (e) => {
      const h = this.pick(e.offsetX, e.offsetY);
      if (h) this.focusBody(h.state.def.id, true);
    });
  }

  private zoomAt(x: number, y: number, f: number): void {
    const before = this.toWorld(x, y, _a);
    this.scale = this.targetScale = Math.min(Math.max(this.scale * f, 1e-9), 2);
    const after = this.toWorld(x, y, _b);
    if (this.follow && f > 1) {
      // keep following the focus when zooming in
    } else {
      this.follow = null;
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
    }
  }

  private pick(x: number, y: number): Hit | null {
    let best: Hit | null = null;
    let bd = 14;
    for (let i = 0; i < this.hitN; i++) {
      const h = this.hits[i];
      const d = Math.hypot(h.x - x, h.y - y) - h.r;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  private click(x: number, y: number): void {
    if (this.gateXY && Math.hypot(this.gateXY[0] - x, this.gateXY[1] - y) < 16) {
      this.select({ kind: 'gate' });
      return;
    }
    const h = this.pick(x, y);
    if (h) {
      this.select({ kind: 'body', id: h.state.def.id });
      return;
    }
    if (this.remote) return;
    // coordinates: relative to the most relevant body on screen (the focus, else the Sun)
    const p = this.toWorld(x, y, new Vector3());
    const frameId = this.follow ?? this.eph.system.star;
    const f = this.eph.get(frameId);
    const off = new Vector3(p.x - f.pos.x, 0, p.z - f.pos.z);
    const label = `${fmtDistance(off.length())} from ${f.def.name}`;
    this.select({ kind: 'point', frame: frameId, offset: off, label });
  }

  private renderInfo(): void {
    const t = this.selection;
    this.info.innerHTML = '';
    this.shown.clear();
    this.distEl = null;
    this.chipEls = [];
    for (const [id, b] of this.listButtons) b.classList.toggle('on', t?.kind === 'body' && t.id === id);
    this.gateButton?.classList.toggle('on', t?.kind === 'gate');
    if (!t) {
      this.info.append(el('div', 'muted', 'Select a destination'));
      return;
    }
    const name = this.warp.targetName(t);
    this.info.append(el('div', 'info-name', name));
    if (t.kind === 'body') {
      const d = this.eph.get(t.id).def;
      const kind = d.kind === 'star' ? 'Star' : d.kind === 'planet' ? 'Planet' : d.kind === 'dwarf' ? 'Dwarf planet' : `Moon of ${this.eph.get(d.parent!).def.name}`;
      this.info.append(el('div', 'info-kind', `${kind} · radius ${Math.round(d.radius).toLocaleString('en-US')} km`));
      this.info.append(el('div', 'info-text', d.info));
    } else if (t.kind === 'gate') {
      const here = this.viewSys;
      const to = SYSTEMS.filter((o) => o.id !== here.id)
        .map((o) => `${o.name} (${Math.round(lightYearsBetween(here, o)).toLocaleString('en-US')} light years)`).join(', ');
      this.info.append(el('div', 'info-kind', `Warp gate · ${(here.gate.distance / AU_KM).toFixed(0)} AU from ${this.star.def.name}`));
      this.info.append(el('div', 'info-text', `The way to other stars: ${to}. Warp here, fly within ${GATE.range} km and choose a destination at the gate.`));
    } else {
      this.info.append(el('div', 'info-kind', 'Coordinates in the ecliptic plane'));
    }
    if (this.remote) {
      this.info.append(el('div', 'info-dist', `In another star system, ${Math.round(lightYearsBetween(this.eph.system, this.viewSys)).toLocaleString('en-US')} light years away. The warp gate is the way there.`));
      const go = el('button', 'btn primary', 'SET COURSE FOR THE GATE');
      go.onclick = () => this.galaxy.onCourse?.();
      this.info.append(go);
      return;
    }
    this.distEl = el('div', 'info-dist');
    this.info.append(this.distEl);
    const chips = el('div', 'chips');
    for (const f of WARP_FACTORS) {
      const b = el('button', 'chip' + (f === this.warp.factor ? ' on' : ''));
      b.append(el('b', undefined, `${f}c`));
      const eta = el('span');
      b.append(eta);
      this.chipEls.push(eta);
      b.onclick = () => {
        this.onFactor?.(f);
        this.renderInfo();
      };
      chips.append(b);
    }
    this.info.append(chips);
    const go = el('button', 'btn primary', `WARP ${this.warp.factor}c`);
    go.onclick = () => this.onWarp?.(t, this.warp.factor);
    this.info.append(go);
    this.updateInfo();
  }

  /** Writes text only when it changed, so the panel never forces a layout for nothing. */
  private setText(e: HTMLElement, s: string): void {
    if (this.shown.get(e) === s) return;
    this.shown.set(e, s);
    e.textContent = s;
  }

  private updateInfo(): void {
    const t = this.selection;
    if (!t || !this.distEl || this.remote) return;
    const p = this.warp.resolve(_a, t);
    if (!p) return;
    const ship = this.ship.absPos(_b);
    // warp times are for the trip to the arrival point; the distance shown is to the body's centre
    const d = p.distanceTo(ship);
    const dc = t.kind === 'body' ? this.eph.get(t.id).pos.distanceTo(ship) : d;
    this.setText(this.distEl, `Distance ${fmtDistance(dc)} · light time ${fmtDuration(dc / C_KMS)}`);
    WARP_FACTORS.forEach((f, i) => this.setText(this.chipEls[i], fmtDuration(d / (f * C_KMS))));
  }

  private orbit(s: BodyState, simMs: number, allowResample: boolean): Orbit {
    let o = this.orbits.get(s.def.id);
    // the shape barely changes over time; refresh after a few percent of a period, one orbit per frame
    const a = s.pos.distanceTo(s.parent!.pos);
    const period = 2 * Math.PI * Math.sqrt((a * a * a) / s.parent!.def.gm) * 1000;
    const stale = o && Math.abs(o.t - simMs) > Math.max(12 * 3.6e6, period * 0.03);
    if (!o || (stale && allowResample)) {
      const planet = s.parent?.def.kind === 'star';
      const pts = this.eph.sampleOrbit(s.def.id, planet ? 360 : 128);
      const xz = new Float64Array(pts.length * 2);
      let rMin = Infinity, rMax = 0;
      pts.forEach((p, i) => {
        xz[i * 2] = p.x;
        xz[i * 2 + 1] = p.z;
        const r = Math.hypot(p.x, p.z);
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
      });
      o = {
        t: simMs, xz, rMin, rMax,
        stroke: bodyRgb(s.def.color, 0.9, planet ? 0.3 : 0.2),
        strokeHi: bodyRgb(s.def.color, 1.05, 0.55),
      };
      this.orbits.set(s.def.id, o);
    }
    return o;
  }

  /**
   * Strokes an orbit clipped to the screen, so a huge orbit seen at close zoom costs no more than a
   * small one. The body's own position is spliced in, so the line always runs exactly through it.
   */
  private strokeOrbit(o: Orbit, s: BodyState, px: number, py: number): void {
    const ctx = this.ctx;
    const { xz } = o;
    const n = xz.length / 2;
    const sc = this.scale;
    const rx = s.pos.x - s.parent!.pos.x, rz = s.pos.z - s.parent!.pos.z;
    let j = 0, jd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (xz[i * 2] - rx) ** 2 + (xz[i * 2 + 1] - rz) ** 2;
      if (d < jd) {
        jd = d;
        j = i;
      }
    }
    const dPrev = j > 0 ? (xz[j * 2 - 2] - rx) ** 2 + (xz[j * 2 - 1] - rz) ** 2 : Infinity;
    const dNext = j < n - 1 ? (xz[j * 2 + 2] - rx) ** 2 + (xz[j * 2 + 3] - rz) ** 2 : Infinity;
    const at = (dPrev < dNext ? j : j + 1); // the body goes before this sample
    const { W, H } = this;
    // perturbed orbits sampled over one period end a little short of where they began: close the gap
    const closes = Math.hypot(xz[0] - xz[n * 2 - 2], xz[1] - xz[n * 2 - 1]) < o.rMax * 0.05;
    let lx = 0, ly = 0, pen = false;
    ctx.beginPath();
    for (let w = 0; w <= n + (closes ? 1 : 0); w++) {
      const v = w > n ? 0 : w;
      let kx: number, kz: number;
      if (v === at) {
        kx = rx;
        kz = rz;
      } else {
        const i = v < at ? v : v - 1;
        kx = xz[i * 2];
        kz = xz[i * 2 + 1];
      }
      const x = px + kx * sc, y = py + kz * sc;
      if (w > 0) {
        if (clip(lx, ly, x, y, W, H)) {
          const dx = x - lx, dy = y - ly;
          if (!pen || clipT0 > 0) ctx.moveTo(lx + dx * clipT0, ly + dy * clipT0);
          ctx.lineTo(lx + dx * clipT1, ly + dy * clipT1);
          pen = clipT1 === 1;
        } else pen = false;
      }
      lx = x;
      ly = y;
    }
    ctx.stroke();
  }

  private addHit(state: BodyState, x: number, y: number, r: number): void {
    let h = this.hits[this.hitN];
    if (!h) this.hits.push((h = { state, x, y, r }));
    h.state = state;
    h.x = x;
    h.y = y;
    h.r = r;
    this.hitN++;
  }

  /** Places a label unless it would overlap one already placed. */
  private label(text: string, x: number, y: number, font: string, color: string): void {
    const ctx = this.ctx;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    if (x + w > this.W - 8) x = Math.max(8, this.W - 8 - w);
    const L = this.labels;
    for (let i = 0; i < L.length; i += 3) {
      if (x < L[i] + L[i + 2] + 6 && L[i] < x + w + 6 && Math.abs(L[i + 1] - y) < 13) return;
    }
    L.push(x, y, w);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  draw(simMs: number, time: number): void {
    if (!this.open) return;
    if (this.mode === 'galaxy') {
      this.galaxy.draw(time);
      return;
    }
    const { ctx, dpr, W, H } = this;
    // ease the zoom at the same pace whatever the frame rate
    const dt = Math.min(Math.max(time - this.lastTime, 0), 1);
    this.lastTime = time;
    this.scale *= Math.pow(this.targetScale / this.scale, 1 - Math.pow(0.82, dt * 60));
    if (this.follow) this.center.copy(this.eph.get(this.follow).pos);
    const sc = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1;

    // AU rings around the star
    const sun = this.star;
    const sx = this.sx(sun.pos.x), sy = this.sy(sun.pos.z);
    const far = Math.hypot(Math.max(sx, W - sx), Math.max(sy, H - sy));
    const near = Math.max(0, Math.hypot(Math.max(0, -sx, sx - W), Math.max(0, -sy, sy - H)));
    ctx.strokeStyle = 'rgba(140,180,220,0.07)';
    ctx.font = `600 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const au of AU_RINGS) {
      const r = au * AU_KM * sc;
      // a ring much bigger than the screen is just a line across it: skip it
      if (r < 40 || r > far || r < near || r > 3 * Math.max(W, H)) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(160,195,230,0.4)';
      ctx.fillText(`${au} AU`, sx, sy - r - 3);
    }
    ctx.textAlign = 'left';

    // orbits, clipped to the screen
    const sel = this.selection;
    const selId = sel?.kind === 'body' ? sel.id : null;
    let resampled = false;
    for (const s of this.bodies) {
      if (!s.parent) continue;
      if (s.pos.distanceTo(s.parent.pos) * sc < 7) continue;
      const o = this.orbit(s, simMs, !resampled);
      if (o.t === simMs) resampled = true;
      const px = this.sx(s.parent.pos.x), py = this.sy(s.parent.pos.z);
      const rOut = o.rMax * sc + 2, rIn = o.rMin * sc - 2;
      // skip orbits wholly off screen, or wrapping round the screen without crossing it
      const cx = Math.max(0, Math.min(W, px)), cy = Math.max(0, Math.min(H, py));
      if (Math.hypot(cx - px, cy - py) > rOut) continue;
      if (Math.hypot(Math.max(px, W - px), Math.max(py, H - py)) < rIn) continue;
      // highlight the selected or hovered body's orbit while it reads as an orbit, not a line across the screen
      const hi = (s.def.id === selId || s === this.hover) && rOut < 3 * Math.max(W, H);
      ctx.strokeStyle = hi ? o.strokeHi : o.stroke;
      ctx.lineWidth = hi ? 1.5 : 1;
      this.strokeOrbit(o, s, px, py);
    }
    ctx.lineWidth = 1;

    // bodies, at true size and position; planets first so moon labels yield
    this.hitN = 0;
    this.labels.length = 0;
    ctx.textBaseline = 'middle';
    for (let depth = 0; depth <= 2; depth++) {
      for (const s of this.bodies) {
        if (s.depth !== depth) continue;
        // a moon whose orbit is under a few pixels would sit on top of its planet
        if (depth > 1 && s.pos.distanceTo(s.parent!.pos) * sc < 7) continue;
        const x = this.sx(s.pos.x), y = this.sy(s.pos.z);
        const reach = (s.def.rings?.outer ?? s.def.radius) * sc + 60;
        if (x < -reach || y < -reach || x > W + reach || y > H + reach) continue;
        const r = drawBody(ctx, s, x, y, sc, { sun });
        this.addHit(s, x, y, r);
        const on = s.def.id === selId, hov = s === this.hover;
        if (hov && !on) {
          ctx.strokeStyle = 'rgba(220,240,255,0.55)';
          ctx.beginPath();
          ctx.arc(x, y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        const big = depth <= 1;
        this.label(
          big ? s.def.name.toUpperCase() : s.def.name, x + r + 6, y,
          big ? `700 12px ${FONT}` : `500 12px ${FONT}`,
          on ? AMBER : hov ? '#ffffff' : big ? 'rgba(225,238,255,0.92)' : 'rgba(185,205,230,0.72)',
        );
      }
    }

    // the warp gate: a small ring standing edge-on, in violet
    {
      const g = gatePosition(this.eph, _a, this.viewSys);
      const gx = this.sx(g.x), gy = this.sy(g.z);
      this.gateXY = null;
      if (gx > -40 && gy > -40 && gx < W + 40 && gy < H + 40) {
        this.gateXY = [gx, gy];
        const on = sel?.kind === 'gate';
        ctx.strokeStyle = on ? AMBER : GATE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(gx, gy, 6, 6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 10 + Math.sin(time * 2) * 1.5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.45;
        ctx.stroke();
        ctx.globalAlpha = 1;
        this.label('WARP GATE', gx + 14, gy, `700 12px ${FONT}`, on ? AMBER : GATE_COLOR);
      }
    }

    // target: a ring on the body itself, the route to the arrival point beside it
    const shipAbs = this.ship.absPos(_b);
    const shx = this.sx(shipAbs.x), shy = this.sy(shipAbs.z);
    if (sel && !this.remote) {
      const p = this.warp.resolve(_a, sel);
      if (p) {
        const tx = this.sx(p.x), ty = this.sy(p.z);
        ctx.strokeStyle = AMBER;
        // clipped first: dashing a line that runs millions of pixels off screen would stall the frame
        if (clip(shx, shy, tx, ty, W, H)) {
          const dx = tx - shx, dy = ty - shy;
          const len = Math.hypot(dx, dy);
          ctx.setLineDash([6, 6]);
          ctx.lineDashOffset = ((-time * 20 + clipT0 * len) % 12);
          ctx.beginPath();
          ctx.moveTo(shx + dx * clipT0, shy + dy * clipT0);
          ctx.lineTo(shx + dx * clipT1, shy + dy * clipT1);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const pulse = Math.sin(time * 4) * 2;
        let cross = true;
        if (sel.kind === 'body') {
          const b = this.eph.get(sel.id);
          const bx = this.sx(b.pos.x), by = this.sy(b.pos.z);
          const br = Math.max((b.def.rings?.outer ?? b.def.radius) * sc, 4);
          if (br < W * 2) {
            ctx.beginPath();
            ctx.arc(bx, by, br + 6 + pulse, 0, Math.PI * 2);
            ctx.stroke();
          }
          // mark the arrival point once it separates from the body's ring
          cross = Math.hypot(tx - bx, ty - by) > br + 14;
        } else {
          ctx.beginPath();
          ctx.arc(tx, ty, 9 + pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (cross) {
          ctx.beginPath();
          ctx.moveTo(tx - 5, ty);
          ctx.lineTo(tx + 5, ty);
          ctx.moveTo(tx, ty - 5);
          ctx.lineTo(tx, ty + 5);
          ctx.stroke();
        }
      }
    }

    // ship: outlined so the body underneath stays visible; the dot is its exact position
    if (!this.remote) this.drawShip(shx, shy);
    this.drawScale(sc, H);

    // the panel's numbers change slowly: a few updates a second is plenty
    this.infoAge += dt;
    if (this.infoAge > 0.25) {
      this.infoAge = 0;
      this.updateInfo();
    }
  }

  private drawShip(shx: number, shy: number): void {
    const ctx = this.ctx;
    const f = this.ship.forward(_a);
    ctx.save();
    ctx.translate(shx, shy);
    ctx.rotate(Math.atan2(f.z, f.x));
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, -6);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText('YOU', shx + 10, shy + 12);
  }

  private drawScale(sc: number, H: number): void {
    const ctx = this.ctx;
    // scale bar
    // a round length, in AU once the bar is that long (as it's labelled)
    const unit = 140 / sc > 0.05 * AU_KM ? AU_KM : 1;
    const len = 140 / sc / unit;
    const pow = Math.pow(10, Math.floor(Math.log10(len)));
    const nice = ([1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= len).pop() ?? pow) * unit;
    const px = nice * sc;
    const bx = 24, by = H - 22;
    ctx.strokeStyle = 'rgba(220,235,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + px, by);
    ctx.lineTo(bx + px, by - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,235,255,0.75)';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(fmtDistance(nice), bx, by - 12);
  }
}
