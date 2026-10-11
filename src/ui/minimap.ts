import { Quaternion, Vector3 } from 'three';
import type { BodyState, Ephemeris } from '../sim/ephemeris';
import type { Ship } from '../ship/flight';
import type { WarpDrive } from '../game/warp';
import { AU_KM } from '../sim/constants';

const _rel = new Vector3();
const _ship = new Vector3();
const _tgt = new Vector3();
const _inv = new Quaternion();

/** Log-scale range of the scanner: 100 km at the centre, 1e10 km (~67 AU) at the rim. */
const LOG_MIN = 2;
const LOG_MAX = 10;
/** Viewing elevation above the ship's horizontal plane. */
const ELEV = 24 * (Math.PI / 180);
const SIN_E = Math.sin(ELEV);
const COS_E = Math.cos(ELEV);
const RINGS: [number, string][] = [
  [1e4, '10k km'],
  [1e6, '1M km'],
  [AU_KM, '1 AU'],
];

interface Blip {
  x: number;
  y: number;
  /** foot of the stalk on the plane */
  fy: number;
  depth: number;
  color: string;
  r: number;
  above: boolean;
  label: string;
  priority: number;
  target: boolean;
}

function rgb(c: [number, number, number]): string {
  const m = Math.max(c[0], c[1], c[2]);
  const f = (v: number) => Math.round(Math.min(1, Math.pow(v / m, 0.6) * 1.05) * 255);
  return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
}

function radial(d: number): number {
  return Math.min(1, Math.max(0, (Math.log10(Math.max(d, 1)) - LOG_MIN) / (LOG_MAX - LOG_MIN)));
}

/**
 * Small 3D scanner in the HUD corner. Bodies sit around the ship on a tilted disc
 * aligned with the ship (forward is up the disc), with stalks showing how far
 * above or below the ship's wings they are. Distance is logarithmic so the local
 * moons and the whole planetary system fit at once. Plain 2D canvas, redrawn at
 * up to 30 Hz, so it costs almost nothing next to the 3D view.
 */
export class Minimap {
  readonly root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private acc = 1;
  private colors = new Map<string, string>();
  private blips: Blip[] = [];
  onClick?: () => void;

  constructor(private eph: Ephemeris, private ship: Ship, private warp: WarpDrive) {
    this.root.className = 'minimap panel';
    this.root.title = 'Scanner: nearby bodies around your ship, log distance (click for the map, N to hide)';
    this.root.append(this.canvas);
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClick?.();
    });
  }

  private fit(): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  private color(s: BodyState): string {
    let c = this.colors.get(s.def.id);
    if (!c) {
      c = rgb(s.def.color);
      this.colors.set(s.def.id, c);
    }
    return c;
  }

  update(dt: number, time: number): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    if (!this.fit()) return;
    const { ctx, w, h, dpr } = this;
    const ship = this.ship;
    const R = Math.min(w / 2 - 10, (h * 0.42) / SIN_E);
    const cx = w / 2;
    const cy = h * 0.54;
    // stalks are scaled so a body straight above or below still fits in the box
    const lift = Math.min(COS_E, (Math.min(cy, h - cy) - 6) / R);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // disc: range rings, cross and the forward wedge
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(95,212,255,0.05)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * SIN_E, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 8px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    RINGS.forEach(([d, name], i) => {
      const r = radial(d) * R;
      ctx.strokeStyle = 'rgba(95,212,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * SIN_E, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,200,230,0.42)';
      // alternate sides so neighbouring labels never collide on a small scanner
      ctx.fillText(name, cx + (i % 2 ? -r : r), cy - 1);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(95,212,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * SIN_E, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(95,212,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R * SIN_E);
    ctx.lineTo(cx, cy + R * SIN_E);
    ctx.stroke();
    // forward view cone (about 35° either side of the nose)
    const wedge = ctx.createLinearGradient(cx, cy, cx, cy - R * SIN_E);
    wedge.addColorStop(0, 'rgba(95,212,255,0.16)');
    wedge.addColorStop(1, 'rgba(95,212,255,0)');
    ctx.fillStyle = wedge;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - R * 0.57, cy - R * 0.82 * SIN_E);
    ctx.lineTo(cx + R * 0.57, cy - R * 0.82 * SIN_E);
    ctx.closePath();
    ctx.fill();

    // bodies: the Sun, planets and dwarf planets, the moons of the local system, and the target
    ship.absPos(_ship);
    _inv.copy(ship.quat).invert();
    const sys = ship.frame.def.kind === 'moon' && ship.frame.parent ? ship.frame.parent : ship.frame;
    const tgt = this.warp.target;
    const tgtId = tgt?.kind === 'body' ? tgt.id : null;
    this.blips.length = 0;
    const place = (rel: Vector3, color: string, r: number, label: string, priority: number, target: boolean) => {
      const d = rel.length();
      if (d < 1e-6) return;
      rel.applyQuaternion(_inv).multiplyScalar((radial(d) * R) / d);
      const fy = cy + rel.z * SIN_E;
      const hy = rel.y * lift;
      const y = fy - hy;
      this.blips.push({ x: cx + rel.x, y, fy, depth: rel.z, color, r, above: hy >= 0, label, priority, target });
    };
    for (const s of this.eph.list) {
      const local = s.depth <= 1 || s.parent === sys || s === ship.frame;
      if (!local && s.def.id !== tgtId) continue;
      const near = s === ship.nearest || s === sys;
      const priority = s.def.id === tgtId ? 4 : near ? 3 : s.def.kind === 'star' ? 2 : s.parent === sys ? 1 : 0;
      const r = s.def.kind === 'star' ? 3.6 : s.def.kind === 'moon' ? 1.8 : s.def.kind === 'dwarf' ? 1.6 : 2.6;
      place(_rel.subVectors(s.pos, _ship), this.color(s), near ? r + 0.8 : r, s.def.name, priority, s.def.id === tgtId);
    }
    if (tgt?.kind === 'point' && this.warp.resolve(_tgt, tgt)) {
      place(_rel.subVectors(_tgt, _ship), '#ffb347', 2.2, 'Target', 4, true);
    }

    // back to front
    this.blips.sort((a, b) => a.depth - b.depth);
    for (const b of this.blips) {
      ctx.strokeStyle = b.target ? 'rgba(255,179,71,0.7)' : b.above ? 'rgba(170,215,240,0.5)' : 'rgba(170,215,240,0.28)';
      ctx.setLineDash(b.above ? [] : [2, 2]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.fy);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // footprint on the disc
      ctx.fillStyle = 'rgba(170,215,240,0.35)';
      ctx.fillRect(b.x - 1.5, b.fy - 0.5, 3, 1);
      ctx.globalAlpha = b.above ? 1 : 0.75;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (b.target) {
        const p = b.r + 3.5 + Math.sin(time * 4) * 0.8;
        ctx.strokeStyle = '#ffb347';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - p);
        ctx.lineTo(b.x + p, b.y);
        ctx.lineTo(b.x, b.y + p);
        ctx.lineTo(b.x - p, b.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // the ship: a chevron pointing along the nose
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#5fd4ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7 * SIN_E - 1.5);
    ctx.lineTo(cx + 5, cy + 4 * SIN_E + 1);
    ctx.lineTo(cx, cy + 1.5 * SIN_E);
    ctx.lineTo(cx - 5, cy + 4 * SIN_E + 1);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // a few names: target, the local body, the Sun, then moons, skipping overlaps
    const placed: [number, number, number][] = [];
    ctx.font = '600 9px system-ui, sans-serif';
    const named = this.blips.filter((b) => b.priority > 0).sort((a, b) => b.priority - a.priority);
    for (const b of named) {
      if (placed.length >= 4) break;
      const tw = ctx.measureText(b.label).width;
      let x = b.x + b.r + 3;
      if (x + tw > w - 2) x = b.x - b.r - 3 - tw;
      const y = b.y;
      if (placed.some(([px, py, pw]) => x < px + pw + 4 && px < x + tw + 4 && Math.abs(py - y) < 10)) continue;
      placed.push([x, y, tw]);
      ctx.fillStyle = b.target ? 'rgba(255,200,120,0.95)' : 'rgba(220,235,255,0.85)';
      ctx.fillText(b.label, x, y);
    }
  }
}
