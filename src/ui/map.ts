import { Vector3 } from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import type { WarpDrive, WarpTarget } from '../game/warp';
import { AU_KM, WARP_FACTORS, type WarpFactor } from '../sim/constants';
import { fmtDistance, fmtDuration } from './format';
import { drawBody } from './bodyGlyph';

const _a = new Vector3();
const _b = new Vector3();

interface Hit {
  state: BodyState;
  x: number;
  y: number;
  r: number;
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
  private ctx = this.canvas.getContext('2d')!;
  private info = el('div', 'map-info panel');
  private list = el('div', 'map-list panel');
  open = false;
  /** world km of the screen centre (x, z) */
  private center = new Vector3();
  private follow: string | null = 'sun';
  private scale = 1; // px per km
  private targetScale = 1;
  private hits: Hit[] = [];
  private orbits = new Map<string, { t: number; pts: Vector3[] }>();
  private selection: WarpTarget | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDist = 0;
  private pinch0 = 0;
  private dpr = 1;
  private lastTime = 0;
  onWarp?: (t: WarpTarget, factor: WarpFactor) => void;
  onSelect?: (t: WarpTarget) => void;
  onClose?: () => void;
  onFactor?: (f: WarpFactor) => void;

  constructor(private eph: Ephemeris, private ship: Ship, private warp: WarpDrive) {
    const top = el('div', 'map-top');
    top.append(el('div', 'map-title', 'SOLAR SYSTEM <span>true sizes and distances · top-down ecliptic view</span>'));
    const close = el('button', 'btn icon', '✕');
    close.title = 'Close map (M / Esc)';
    close.onclick = () => this.onClose?.();
    top.append(close);
    const hint = el('div', 'map-hint', 'Scroll / pinch to zoom · drag to pan · click a body, or empty space to warp to coordinates · a ring marks a body too small to see at this zoom');
    this.root.append(this.canvas, top, this.list, this.info, hint);
    this.buildList();
    this.bindPointer();
  }

  private buildList(): void {
    const groups: BodyState[] = this.eph.list.filter((s) => s.def.id === 'sun' || s.parent?.def.id === 'sun');
    for (const g of groups) {
      const row = el('div', 'map-group');
      const b = el('button', 'map-body', g.def.name);
      b.onclick = () => this.focusBody(g.def.id, true);
      row.append(b);
      if (g.children.length) {
        const kids = el('div', 'map-moons');
        for (const k of g.children) {
          const kb = el('button', 'map-moon', k.def.name);
          kb.onclick = () => this.focusBody(k.def.id, true);
          kids.append(kb);
        }
        row.append(kids);
      }
      this.list.append(row);
    }
  }

  /** Centres on a body and zooms so its moon system (or the body) fits. */
  focusBody(id: string, select: boolean): void {
    const s = this.eph.get(id);
    this.follow = id;
    this.center.copy(s.pos);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    let extent: number;
    if (id === 'sun') extent = Math.max(...s.children.map((c) => c.pos.length())) * 1.05;
    else if (s.children.length) extent = Math.max(...s.children.map((c) => c.pos.distanceTo(s.pos))) * 1.25;
    else extent = s.def.radius * 40;
    this.targetScale = (Math.min(w, h) * 0.45) / extent;
    if (select) this.select({ kind: 'body', id });
  }

  private select(t: WarpTarget): void {
    this.selection = t;
    this.onSelect?.(t);
    this.renderInfo();
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
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
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr) || 1;
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr) || 1;
  }

  private toScreen(p: Vector3): [number, number] {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    return [w / 2 + (p.x - this.center.x) * this.scale, h / 2 + (p.z - this.center.z) * this.scale];
  }

  private toWorld(x: number, y: number, out: Vector3): Vector3 {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    return out.set(this.center.x + (x - w / 2) / this.scale, 0, this.center.z + (y - h / 2) / this.scale);
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
      if (!p) return;
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      if (this.pointers.size === 1) {
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        if (this.dragDist > 4) {
          this.follow = null;
          this.center.x -= dx / this.scale;
          this.center.z -= dy / this.scale;
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
      if (had && this.pointers.size === 0 && this.dragDist <= 4) this.click(e.offsetX, e.offsetY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
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
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y) - h.r;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  private click(x: number, y: number): void {
    const h = this.pick(x, y);
    if (h) {
      this.select({ kind: 'body', id: h.state.def.id });
      return;
    }
    // coordinates: relative to the most relevant body on screen (the focus, else the Sun)
    const p = this.toWorld(x, y, new Vector3());
    const frameId = this.follow ?? 'sun';
    const f = this.eph.get(frameId);
    const off = new Vector3(p.x - f.pos.x, 0, p.z - f.pos.z);
    const label = `${fmtDistance(off.length())} from ${f.def.name}`;
    this.select({ kind: 'point', frame: frameId, offset: off, label });
  }

  private renderInfo(): void {
    const t = this.selection;
    this.info.innerHTML = '';
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
    } else {
      this.info.append(el('div', 'info-kind', 'Coordinates in the ecliptic plane'));
    }
    const dist = el('div', 'info-dist');
    this.info.append(dist);
    const chips = el('div', 'chips');
    for (const f of WARP_FACTORS) {
      const b = el('button', 'chip' + (f === this.warp.factor ? ' on' : ''));
      b.dataset.f = String(f);
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

  private updateInfo(): void {
    const t = this.selection;
    if (!t) return;
    const p = this.warp.resolve(_a, t);
    if (!p) return;
    const ship = this.ship.absPos(_b);
    // warp times are for the trip to the arrival point; the distance shown is to the body's centre
    const d = p.distanceTo(ship);
    const dc = t.kind === 'body' ? this.eph.get(t.id).pos.distanceTo(ship) : d;
    const dist = this.info.querySelector('.info-dist');
    if (dist) dist.textContent = `Distance ${fmtDistance(dc)} · light time ${fmtDuration(dc / 299792.458)}`;
    this.info.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
      const f = Number(b.dataset.f);
      b.innerHTML = `<b>${f}c</b><span>${fmtDuration(d / (f * 299792.458))}</span>`;
    });
  }

  private orbit(s: BodyState, simMs: number): Vector3[] {
    let c = this.orbits.get(s.def.id);
    if (!c || Math.abs(c.t - simMs) > 12 * 3.6e6) {
      c = { t: simMs, pts: this.eph.sampleOrbit(s.def.id, s.parent?.def.id === 'sun' ? 360 : 128) };
      this.orbits.set(s.def.id, c);
    }
    return c.pts;
  }

  draw(simMs: number, time: number): void {
    if (!this.open) return;
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    // ease the zoom at the same pace whatever the frame rate
    const dt = Math.min(Math.max(time - this.lastTime, 0), 1);
    this.lastTime = time;
    this.scale *= Math.pow(this.targetScale / this.scale, 1 - Math.pow(0.82, dt * 60));
    if (this.follow) this.center.copy(this.eph.get(this.follow).pos);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#02050a';
    ctx.fillRect(0, 0, W, H);

    // AU rings around the Sun
    const sun = this.eph.get('sun');
    const [sx, sy] = this.toScreen(sun.pos);
    ctx.lineWidth = 1;
    for (const au of [0.1, 0.5, 1, 2, 5, 10, 20, 30, 40, 50]) {
      const r = au * AU_KM * this.scale;
      if (r < 30 || r > Math.max(W, H) * 3) continue;
      ctx.strokeStyle = 'rgba(120,160,200,0.07)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,160,200,0.35)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`${au} AU`, sx + r * 0.707 + 4, sy - r * 0.707);
    }

    // orbits
    for (const s of this.eph.list) {
      if (!s.parent) continue;
      const pr = s.pos.distanceTo(s.parent.pos) * this.scale;
      if (pr < 6) continue;
      const pts = this.orbit(s, simMs);
      const isPlanet = s.parent.def.id === 'sun';
      ctx.strokeStyle = isPlanet ? 'rgba(95,212,255,0.28)' : 'rgba(95,212,255,0.18)';
      ctx.beginPath();
      const base = s.parent.pos;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this.toScreen(_a.copy(pts[i]).add(base));
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }

    // bodies, at true size and position
    this.hits = [];
    const labels: [number, number][] = [];
    ctx.textBaseline = 'middle';
    // draw planets before moons so moon labels yield
    const order = [...this.eph.list].sort((a, b) => a.depth - b.depth);
    for (const s of order) {
      if (s.parent && s.parent.def.id !== 'sun') {
        // a moon whose orbit is under a few pixels would sit on top of its planet
        const pr = s.pos.distanceTo(s.parent.pos) * this.scale;
        if (pr < 7) continue;
      }
      const [x, y] = this.toScreen(s.pos);
      const reach = (s.def.rings?.outer ?? s.def.radius) * this.scale + 50;
      if (x < -reach || y < -reach || x > W + reach || y > H + reach) continue;
      const r = drawBody(ctx, s, x, y, this.scale, { sun });
      this.hits.push({ state: s, x, y, r });
      if (!labels.some(([lx, ly]) => Math.abs(lx - x) < 60 && Math.abs(ly - y) < 14)) {
        labels.push([x, y]);
        ctx.fillStyle = s.depth <= 1 ? 'rgba(220,235,255,0.9)' : 'rgba(180,200,225,0.7)';
        ctx.font = `${s.depth <= 1 ? 600 : 500} ${s.depth <= 1 ? 13 : 11}px system-ui, sans-serif`;
        ctx.fillText(s.def.name, Math.min(x + r + 5, W - 60), y);
      }
    }

    // target: a ring on the body itself, the route to the arrival point beside it
    const shipAbs = this.ship.absPos(_b);
    const [shx, shy] = this.toScreen(shipAbs);
    const sel = this.selection;
    if (sel) {
      const p = this.warp.resolve(_a, sel);
      if (p) {
        const [tx, ty] = this.toScreen(p);
        ctx.strokeStyle = 'rgba(255,179,71,0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -time * 20;
        ctx.beginPath();
        ctx.moveTo(shx, shy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        const pulse = Math.sin(time * 4) * 2;
        let cross = true;
        if (sel.kind === 'body') {
          const b = this.eph.get(sel.id);
          const [bx, by] = this.toScreen(b.pos);
          const br = Math.max((b.def.rings?.outer ?? b.def.radius) * this.scale, 4);
          ctx.beginPath();
          ctx.arc(bx, by, br + 6 + pulse, 0, Math.PI * 2);
          ctx.stroke();
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
    // ship
    const f = this.ship.forward(_a);
    ctx.save();
    ctx.translate(shx, shy);
    ctx.rotate(Math.atan2(f.z, f.x));
    // outlined so the body underneath stays visible; the dot is the ship's exact position
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#5fd4ff';
    ctx.shadowBlur = 6;
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
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('YOU', shx + 10, shy + 12);

    // scale bar
    const targetPx = 140;
    const km = targetPx / this.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(km)));
    const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= km).pop() ?? pow;
    const px = nice * this.scale;
    ctx.strokeStyle = 'rgba(220,235,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(24, H - 30);
    ctx.lineTo(24 + px, H - 30);
    ctx.moveTo(24, H - 35);
    ctx.lineTo(24, H - 25);
    ctx.moveTo(24 + px, H - 35);
    ctx.lineTo(24 + px, H - 25);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,235,255,0.8)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(fmtDistance(nice), 24, H - 46);
    this.updateInfo();
  }
}
