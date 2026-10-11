import { SYSTEMS, SYSTEM_BY_ID, lightYearsBetween, PC_LY } from '../sim/systems';
import { BODIES, BODY_BY_ID } from '../sim/bodies';

const FONT = "'Rajdhani', 'Segoe UI', system-ui, sans-serif";
const BASE = import.meta.env.BASE_URL;
/** the Sun's distance from the Galactic Centre (pc) */
const R0 = 8178;
/** half the width of the galaxy picture (pc), centred on the Galactic Centre (tools/build_galaxy_map.py) */
const HALF = 18000;
const AMBER = 'rgba(255,179,71,0.95)';

/**
 * Arm names, placed on the arms of tools/build_galaxy_map.py: (radius where the arm crosses the Sun's
 * azimuth in kpc, galactocentric azimuth of the label relative to the Sun's in radians, pitch in degrees).
 */
const ARM_LABELS: [string, number, number, number][] = [
  ['Perseus Arm', 10.3, 0.75, 12],
  ['Sagittarius–Carina Arm', 7.0, 0.95, 12],
  ['Scutum–Centaurus Arm', 5.1, 1.2, 12],
  ['Norma Arm', 3.75, 1.6, 12],
  ['Outer Arm', 14.4, 0.45, 12],
  ['Orion Spur', 8.35, -0.3, 11.4],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function planetCount(id: string): number {
  return BODIES.filter((b) => (b.system ?? 'sol') === id && b.kind === 'planet').length;
}

/** Spectral class from temperature (main sequence). */
function spectral(teff: number): string {
  const t: [number, string][] = [[30000, 'O'], [10000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [0, 'M']];
  const i = t.findIndex(([T]) => teff >= T);
  const [hi, cls] = t[i];
  const lo = i > 0 ? t[i - 1][0] : hi * 1.5;
  const sub = Math.min(9, Math.max(0, Math.floor(((lo - teff) / (lo - hi)) * 10)));
  return `${cls}${sub}`;
}

/**
 * Face-on map of the Milky Way with the star systems you can visit at their real positions, seen from
 * the north galactic pole with the Galactic Centre up. Positions are in heliocentric galactic parsecs
 * (x toward the centre, y toward longitude 90 degrees, which is to the left).
 */
export class GalaxyMap {
  readonly root = el('div', 'galaxy');
  private canvas = el('canvas', 'map-canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private info = el('div', 'map-info panel');
  private img: HTMLImageElement | null = null;
  private loaded = false;
  /** px per pc */
  private scale = 0.02;
  private targetScale = 0.02;
  private cx = 0;
  private cy = 0;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private selected: string | null = null;
  private here = 'sol';
  private pointers = new Map<number, { x: number; y: number }>();
  private dragDist = 0;
  private pinch0 = 0;
  private lastTime = 0;
  private hits: { id: string; x: number; y: number }[] = [];
  /** show this system's planets on the system map */
  onView?: (id: string) => void;
  /** set course for the warp gate of the system the ship is in */
  onCourse?: () => void;

  constructor() {
    const hint = el('div', 'map-hint', 'Scroll or pinch to zoom · drag to pan · tap a star system to select it');
    this.root.append(this.canvas, this.info, hint);
    this.bindPointer();
  }

  /** Opens on the ship's system, zoomed so the Galactic Centre is in view. */
  show(here: string): void {
    this.here = here;
    if (!this.img) {
      this.img = new Image();
      this.img.onload = () => (this.loaded = true);
      this.img.src = `${BASE}textures/galaxy_map_2048.webp`;
    }
    this.resize();
    const sys = SYSTEM_BY_ID[here];
    this.cx = sys.galactic.x + 2500;
    this.cy = sys.galactic.y;
    this.scale = this.targetScale = (Math.min(this.W, this.H) * 0.5) / 9000;
    this.selected ??= SYSTEMS.find((s) => s.id !== here)?.id ?? here;
    this.renderInfo();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.root.clientWidth || window.innerWidth;
    this.H = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr) || 1;
    this.canvas.height = Math.round(this.H * this.dpr) || 1;
  }

  // up is +x (toward the centre), left is +y
  private sx(y: number): number {
    return this.W / 2 - (y - this.cy) * this.scale;
  }

  private sy(x: number): number {
    return this.H / 2 - (x - this.cx) * this.scale;
  }

  private select(id: string): void {
    this.selected = id;
    this.renderInfo();
  }

  private renderInfo(): void {
    const info = this.info;
    info.innerHTML = '';
    const s = this.selected ? SYSTEM_BY_ID[this.selected] : null;
    if (!s) {
      info.append(el('div', 'muted', 'Select a star system'));
      return;
    }
    const star = BODY_BY_ID[s.star];
    const here = SYSTEM_BY_ID[this.here];
    info.append(el('div', 'info-name', s.name));
    const n = planetCount(s.id);
    info.append(el('div', 'info-kind', `${spectral(star.teff ?? 5772)} star · ${n} planet${n === 1 ? '' : 's'}${s.constellation ? ` · in ${s.constellation}` : ''}`));
    info.append(el('div', 'info-text', s.blurb));
    const dist = s.id === here.id ? 'You are here' : `${Math.round(lightYearsBetween(here, s)).toLocaleString('en-US')} light years from ${here.id === 'sol' ? 'the Sun' : here.name}`;
    info.append(el('div', 'info-dist', dist));
    const row = el('div', 'galaxy-actions');
    const view = el('button', 'btn', 'VIEW PLANETS');
    view.onclick = () => this.onView?.(s.id);
    row.append(view);
    if (s.id !== here.id) {
      const go = el('button', 'btn primary', 'GO VIA WARP GATE');
      go.title = `Set course for the warp gate, the way to ${s.name}`;
      go.onclick = () => this.onCourse?.();
      row.append(go);
    }
    info.append(row);
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
        if (e.pointerType === 'mouse') c.style.cursor = this.pick(e.offsetX, e.offsetY) ? 'pointer' : '';
        return;
      }
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
      if (this.pointers.size === 1) {
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        if (this.dragDist > 4) {
          this.cy += dx / this.scale;
          this.cx += dy / this.scale;
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
    c.addEventListener('pointerup', (e) => {
      const had = this.pointers.delete(e.pointerId);
      c.style.cursor = '';
      if (had && this.pointers.size === 0 && this.dragDist <= 4) {
        const id = this.pick(e.offsetX, e.offsetY);
        if (id) this.select(id);
      }
    });
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('dblclick', (e) => {
      const id = this.pick(e.offsetX, e.offsetY);
      if (id) this.onView?.(id);
    });
  }

  private pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = 18;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) {
        bd = d;
        best = h.id;
      }
    }
    return best;
  }

  private zoomAt(x: number, y: number, f: number): void {
    const min = Math.min(this.W, this.H) / (2.4 * HALF);
    const max = 0.6;
    // keep the point under the cursor still
    const gy = this.cy - (x - this.W / 2) / this.scale;
    const gx = this.cx - (y - this.H / 2) / this.scale;
    this.scale = this.targetScale = Math.min(Math.max(this.scale * f, min), max);
    this.cy = gy + (x - this.W / 2) / this.scale;
    this.cx = gx + (y - this.H / 2) / this.scale;
  }

  draw(time: number): void {
    const { ctx, dpr, W, H } = this;
    const dt = Math.min(Math.max(time - this.lastTime, 0), 1);
    this.lastTime = time;
    this.scale *= Math.pow(this.targetScale / this.scale, 1 - Math.pow(0.82, dt * 60));
    const sc = this.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010206';
    ctx.fillRect(0, 0, W, H);

    // the galaxy: the picture spans x = R0 +- HALF, y = +-HALF (heliocentric)
    if (this.img && this.loaded) {
      const left = this.sx(HALF), top = this.sy(R0 + HALF);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.img, left, top, 2 * HALF * sc, 2 * HALF * sc);
    }

    // rings round the centre every 5 kpc, faint
    const gcx = this.sx(0), gcy = this.sy(R0);
    ctx.strokeStyle = 'rgba(140,180,220,0.07)';
    ctx.lineWidth = 1;
    for (let r = 5000; r <= 15000; r += 5000) {
      ctx.beginPath();
      ctx.arc(gcx, gcy, r * sc, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = 'rgba(255,230,190,0.75)';
    if (sc * 1000 > 12) ctx.fillText('GALACTIC CENTRE', gcx, gcy + Math.max(14, 1100 * sc));

    // arm names, once there is room for them
    if (sc > 0.012) {
      ctx.font = `italic 500 ${sc > 0.05 ? 14 : 12}px ${FONT}`;
      ctx.fillStyle = 'rgba(190,210,240,0.42)';
      for (const [name, rs, dth, pitch] of ARM_LABELS) {
        const th = Math.PI + dth;
        const r = rs * 1000 * Math.exp(Math.tan((pitch * Math.PI) / 180) * dth);
        // galactocentric (r cos th, r sin th) -> heliocentric x = X + R0, y = Y
        ctx.fillText(name, this.sx(r * Math.sin(th)), this.sy(r * Math.cos(th) + R0));
      }
    }

    // the line from here to the selected system
    const here = SYSTEM_BY_ID[this.here];
    const sel = this.selected ? SYSTEM_BY_ID[this.selected] : null;
    if (sel && sel !== here) {
      const ax = this.sx(here.galactic.y), ay = this.sy(here.galactic.x);
      const bx = this.sx(sel.galactic.y), by = this.sy(sel.galactic.x);
      ctx.strokeStyle = 'rgba(190,160,255,0.7)';
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -time * 14;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 120) {
        ctx.save();
        ctx.translate((ax + bx) / 2, (ay + by) / 2);
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.rotate(ang);
        ctx.font = `600 12px ${FONT}`;
        ctx.fillStyle = 'rgba(215,200,255,0.9)';
        ctx.fillText(`${Math.round(lightYearsBetween(here, sel)).toLocaleString('en-US')} ly`, 0, -10);
        ctx.restore();
      }
    }

    // the systems
    this.hits.length = 0;
    ctx.textAlign = 'left';
    const placed: [number, number][] = [];
    for (const s of SYSTEMS) {
      const x = this.sx(s.galactic.y), y = this.sy(s.galactic.x);
      if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
      this.hits.push({ id: s.id, x, y });
      const on = s === sel, isHere = s === here;
      const star = BODY_BY_ID[s.star];
      const col = starCss(star.teff ?? 5772);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (isHere) {
        ctx.strokeStyle = 'rgba(95,212,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 9 + Math.sin(time * 3) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (on) {
        ctx.strokeStyle = AMBER;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      // labels stack downward when two systems are close on screen
      let ly = y;
      while (placed.some(([px, py]) => Math.abs(px - x) < 150 && Math.abs(py - ly) < 30)) ly += 30;
      placed.push([x, ly]);
      ctx.font = `700 13px ${FONT}`;
      ctx.fillStyle = on ? AMBER : 'rgba(235,244,255,0.95)';
      ctx.fillText(s.name.toUpperCase(), x + 18, ly - 4);
      ctx.font = `500 11px ${FONT}`;
      ctx.fillStyle = isHere ? 'rgba(95,212,255,0.9)' : 'rgba(190,205,225,0.75)';
      ctx.fillText(isHere ? 'YOU ARE HERE' : `${Math.round(lightYearsBetween(here, s)).toLocaleString('en-US')} ly`, x + 18, ly + 10);
    }

    // compass and scale
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(200,215,235,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText('↑ toward the Galactic Centre · seen from galactic north', 24, H - 52);
    const lyPerPx = PC_LY / sc;
    const want = 140 * lyPerPx;
    const pow = Math.pow(10, Math.floor(Math.log10(want)));
    const nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= want).pop() ?? pow;
    const px = nice / lyPerPx;
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
    ctx.fillText(`${nice.toLocaleString('en-US')} light years`, bx, by - 12);
  }
}

/** Rough display colour of a star of a given temperature. */
function starCss(teff: number): string {
  const t = Math.min(1, Math.max(0, (teff - 3000) / 7000));
  const r = Math.round(255 - 60 * Math.max(0, t - 0.4));
  const g = Math.round(180 + 60 * t);
  const b = Math.round(110 + 145 * t);
  return `rgba(${r},${g},${b},0.85)`;
}
