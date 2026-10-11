import { CanvasTexture, Vector3 } from 'three';
import type { Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import type { WarpDrive } from '../game/warp';
import { WARP_FACTORS } from '../sim/constants';
import { fmtDistance, fmtDuration, fmtSpeed } from './format';
import { drawBody } from './bodyGlyph';

const CYAN = '#5fd4ff';
const DIM = 'rgba(95,212,255,0.35)';
const AMBER = '#ffb347';
const WHITE = '#e8f4ff';
const BG = '#03080d';
const FONT = '"Rajdhani", "Segoe UI", system-ui, sans-serif';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

function panel(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

/** Background, faint grid and border of a panel, drawn once per size and then copied. */
const backgrounds = new Map<string, HTMLCanvasElement>();

function background(w: number, h: number): HTMLCanvasElement {
  const key = `${w}x${h}`;
  let c = backgrounds.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(95,212,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x += 24) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y < h; y += 24) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  backgrounds.set(key, c);
  return c;
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string): void {
  ctx.drawImage(background(w, h), 0, 0);
  ctx.fillStyle = CYAN;
  ctx.font = `600 18px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, 16, 14);
  ctx.fillStyle = DIM;
  ctx.fillRect(16, 38, w - 32, 1);
}

/** The three dashboard displays, redrawn at ~10 Hz. */
export class Mfd {
  readonly left = panel(480, 330);
  readonly center = panel(560, 334);
  readonly right = panel(480, 330);
  private t = 0;
  private orbitCache = new Map<string, { t: number; pts: Vector3[] }>();

  constructor(private eph: Ephemeris, private ship: Ship, private warp: WarpDrive) {}

  get textures(): CanvasTexture[] {
    return [this.left.tex, this.center.tex, this.right.tex];
  }

  /** `close`: the screens fill the view (cockpit); from outside they are small, so they refresh less often. */
  update(dt: number, simMs: number, close = true): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = close ? 0.1 : 0.5;
    this.drawShip();
    this.drawNav();
    this.drawSystem(simMs);
    for (const p of [this.left, this.center, this.right]) p.tex.needsUpdate = true;
  }

  private drawShip(): void {
    const { ctx, canvas } = this.left;
    const w = canvas.width, h = canvas.height;
    const s = this.ship;
    frame(ctx, w, h, 'FLIGHT');
    ctx.textBaseline = 'alphabetic';
    // speed
    ctx.fillStyle = WHITE;
    ctx.font = `600 46px ${FONT}`;
    const sp = this.warp.state === 'cruise' ? this.warp.speed : s.speed;
    ctx.fillText(fmtSpeed(sp), 22, 98);
    ctx.fillStyle = DIM;
    ctx.font = `500 16px ${FONT}`;
    ctx.fillText(`LIMIT ${fmtSpeed(s.limit)}`, 24, 122);
    // throttle bar
    const bx = w - 60, by = 56, bh = h - 90;
    ctx.strokeStyle = DIM;
    ctx.strokeRect(bx, by, 26, bh);
    const thr = Math.abs(s.throttle);
    ctx.fillStyle = s.throttle < 0 || thr > 0.95 ? AMBER : CYAN;
    ctx.fillRect(bx + 3, by + bh - 3 - (bh - 6) * thr, 20, (bh - 6) * thr);
    ctx.fillStyle = s.throttle < 0 ? AMBER : DIM;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(s.throttle < 0 ? 'REV' : 'THR', bx, by + bh + 18);
    // altitude & frame
    ctx.fillStyle = CYAN;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(`ALT  ${fmtDistance(s.altitude)}`, 24, 168);
    ctx.fillStyle = DIM;
    ctx.font = `500 16px ${FONT}`;
    ctx.fillText(`NEAREST  ${s.nearest.def.name.toUpperCase()}`, 24, 194);
    ctx.fillText(`FRAME  ${s.frame.def.name.toUpperCase()}`, 24, 216);
    // attitude ball: local horizon relative to the nearest body
    const cx = 120, cy = 270, r = 40;
    const up = _a.subVectors(s.absPos(_b), s.nearest.pos).normalize();
    const q = s.quat.clone().invert();
    const upL = up.clone().applyQuaternion(q); // in ship frame
    const pitch = Math.asin(Math.max(-1, Math.min(1, -upL.z)));
    const roll = Math.atan2(upL.x, upL.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    const off = (pitch / (Math.PI / 2)) * r;
    ctx.fillStyle = 'rgba(95,212,255,0.18)';
    ctx.fillRect(-r * 2, -r * 2, r * 4, off + r * 2);
    ctx.fillStyle = 'rgba(255,179,71,0.18)';
    ctx.fillRect(-r * 2, off, r * 4, r * 3);
    ctx.strokeStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(-r * 2, off);
    ctx.lineTo(r * 2, off);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx + 22, cy);
    ctx.stroke();
    ctx.fillStyle = DIM;
    ctx.font = `500 14px ${FONT}`;
    ctx.fillText(`PITCH ${Math.round((pitch * 180) / Math.PI)}°`, 180, 262);
    ctx.fillText(`ROLL ${Math.round((roll * 180) / Math.PI)}°`, 180, 284);
  }

  private drawNav(): void {
    const { ctx, canvas } = this.center;
    const w = canvas.width, h = canvas.height;
    const wd = this.warp;
    frame(ctx, w, h, 'NAVIGATION · WARP');
    ctx.textBaseline = 'alphabetic';
    if (!wd.target) {
      ctx.fillStyle = DIM;
      ctx.font = `500 22px ${FONT}`;
      ctx.fillText('NO TARGET', 22, 90);
      ctx.font = `500 16px ${FONT}`;
      ctx.fillText('Open the system map (M) and pick a destination', 22, 118);
    } else {
      ctx.fillStyle = WHITE;
      ctx.font = `600 32px ${FONT}`;
      ctx.fillText(wd.targetName().toUpperCase(), 22, 82);
      const p = wd.resolve(_a);
      const d = p ? p.distanceTo(this.ship.absPos(_b)) : 0;
      ctx.fillStyle = CYAN;
      ctx.font = `600 20px ${FONT}`;
      ctx.fillText(`DIST ${fmtDistance(d)}`, 22, 112);
      // ETA table
      let y = 150;
      for (const f of WARP_FACTORS) {
        const sel = f === wd.factor;
        if (sel) {
          ctx.fillStyle = 'rgba(95,212,255,0.14)';
          ctx.fillRect(18, y - 20, w - 36, 28);
        }
        ctx.fillStyle = sel ? WHITE : DIM;
        ctx.font = `600 18px ${FONT}`;
        ctx.fillText(`${f} c`, 28, y);
        ctx.fillText(fmtDuration(wd.eta(f)), 140, y);
        y += 30;
      }
    }
    // state bar
    const state = wd.state === 'idle' ? (wd.target ? 'READY' : 'STANDBY') : wd.state.toUpperCase();
    ctx.fillStyle = wd.state === 'idle' ? DIM : AMBER;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(state, w - 170, 82);
    if (wd.state === 'spooling') {
      ctx.strokeStyle = AMBER;
      ctx.strokeRect(w - 170, 94, 140, 12);
      ctx.fillStyle = AMBER;
      ctx.fillRect(w - 168, 96, 136 * wd.spool, 8);
    }
    if (wd.state === 'cruise') {
      ctx.fillStyle = WHITE;
      ctx.font = `600 18px ${FONT}`;
      ctx.fillText(`${(wd.speed / 299792.458).toFixed(2)} c`, w - 170, 112);
      ctx.fillText(`T- ${fmtDuration(wd.distance / Math.max(wd.speed, 1))}`, w - 170, 136);
    }
  }

  private drawSystem(simMs: number): void {
    const { ctx, canvas } = this.right;
    const w = canvas.width, h = canvas.height;
    const ship = this.ship;
    let center = ship.frame;
    if (center.def.kind === 'moon' && center.parent) center = center.parent;
    frame(ctx, w, h, `SYSTEM · ${center.def.name.toUpperCase()}`);
    const kids = center.children.length ? center.children : [];
    const shipRel = ship.absPos(_a).sub(center.pos);
    let extent = Math.max(shipRel.length() * 1.15, center.def.radius * 6);
    for (const k of kids) {
      const d = k.pos.distanceTo(center.pos);
      if (d < extent * 3 && kids.length < 12) extent = Math.max(extent, d * 1.1);
    }
    if (center.def.id === 'sun') extent = Math.max(shipRel.length() * 1.2, 2.5e8);
    const cx = w / 2, cy = h / 2 + 18;
    const sc = (Math.min(w, h - 50) / 2 - 8) / extent;
    // orbits
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    for (const k of kids) {
      let c = this.orbitCache.get(k.def.id);
      if (!c || Math.abs(c.t - simMs) > 6 * 3.6e6) {
        c = { t: simMs, pts: this.eph.sampleOrbit(k.def.id, 96) };
        this.orbitCache.set(k.def.id, c);
      }
      const pts = c.pts;
      if (k.pos.distanceTo(center.pos) * sc > w) continue;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = cx + p.x * sc, y = cy + p.z * sc;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    // bodies, at true size (a locator ring when smaller than a pixel or so)
    ctx.font = `500 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    const sun = this.eph.get('sun');
    drawBody(ctx, center, cx, cy, sc, { sun, locator: center.def.kind === 'star' ? AMBER : CYAN });
    const labels: [number, number][] = [[cx, cy]];
    for (const k of kids) {
      _b.subVectors(k.pos, center.pos);
      const x = cx + _b.x * sc, y = cy + _b.z * sc;
      if (x < 0 || x > w || y < 40 || y > h) continue;
      const r = drawBody(ctx, k, x, y, sc, { sun, locator: CYAN });
      if (labels.some(([lx, ly]) => Math.abs(lx - x) < 50 && Math.abs(ly - y) < 13)) continue;
      labels.push([x, y]);
      ctx.fillStyle = DIM;
      ctx.fillText(k.def.name, x + r + 4, y);
    }
    // target
    const tp = this.warp.resolve(_c);
    if (tp) {
      tp.sub(center.pos);
      ctx.strokeStyle = AMBER;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx + shipRel.x * sc, cy + shipRel.z * sc);
      ctx.lineTo(cx + tp.x * sc, cy + tp.z * sc);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // ship
    const sx = cx + shipRel.x * sc, sy = cy + shipRel.z * sc;
    const f = ship.forward(_b);
    const ang = Math.atan2(f.z, f.x);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
