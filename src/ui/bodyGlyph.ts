import { Vector3 } from 'three';
import type { BodyState } from '../sim/ephemeris';

/** Below this true radius (px) a body is drawn as a fixed-size locator instead of a disc. */
export const MIN_DISC_PX = 1.5;
/** Radius (px) of the locator ring drawn around bodies too small to see. */
export const LOCATOR_PX = 4;

const _pole = new Vector3();
const _node = new Vector3();
const _w = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Display colour for a body's linear albedo colour, optionally scaled (k) and translucent (alpha). */
export function bodyRgb(c: [number, number, number], k = 1, alpha = 1): string {
  const m = Math.max(c[0], c[1], c[2]);
  const f = (v: number) => Math.round(Math.min(1, Math.pow(v / m, 0.6) * k) * 255);
  return alpha < 1 ? `rgba(${f(c[0])},${f(c[1])},${f(c[2])},${alpha})` : `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
}

const colours = new Map<string, string>();
function cached(s: BodyState, key: string, k: number): string {
  const id = `${s.def.id}:${key}`;
  let c = colours.get(id);
  if (!c) colours.set(id, (c = bodyRgb(s.def.color, k)));
  return c;
}

/** Body rotation axis (world). */
function pole(s: BodyState, out: Vector3): Vector3 {
  const e = s.rot.elements;
  return out.set(e[6], e[7], e[8]).normalize();
}

/**
 * Silhouette of a body seen from above the ecliptic (world +Y), drawn on a map whose screen x/y are
 * world x/z. Returns the ellipse semi-axes (px) and the screen angle of the major axis.
 */
function silhouette(s: BodyState, pxPerKm: number): { a: number; b: number; ang: number } {
  const a = s.def.radius * pxPerKm;
  const c = (s.def.polarRadius ?? s.def.radius) * pxPerKm;
  const p = pole(s, _pole);
  const cg = Math.abs(p.y);
  // the polar axis foreshortens by the angle between the pole and the line of sight
  const b = Math.sqrt(a * a * cg * cg + c * c * (1 - cg * cg));
  // minor axis along the projected pole, so the major axis is perpendicular to it
  const ang = Math.atan2(p.z, p.x) + Math.PI / 2;
  return { a, b, ang };
}

function ringPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, minor: number, ang: number): void {
  ctx.ellipse(x, y, r, Math.max(minor, 0.01), ang, 0, Math.PI * 2);
}

/**
 * Draws a planetary ring system (true size and tilt). With `over` set, draws only the part of the near
 * half (above the planet as seen from +Y) that crosses the planet's disc, to be drawn after the planet.
 */
function drawRings(
  ctx: CanvasRenderingContext2D, s: BodyState, x: number, y: number, pxPerKm: number,
  over?: { a: number; b: number; ang: number },
): void {
  const rings = s.def.rings!;
  const p = pole(s, _pole);
  const k = Math.abs(p.y);
  const ang = Math.atan2(p.z, p.x) + Math.PI / 2;
  const ro = rings.outer * pxPerKm, ri = rings.inner * pxPerKm;
  ctx.save();
  if (over) {
    // the line of nodes on the ecliptic splits the ring into the half above the planet and the half below
    _node.crossVectors(p, UP);
    if (_node.lengthSq() < 1e-12) {
      ctx.restore();
      return;
    }
    _node.normalize();
    _w.crossVectors(p, _node);
    if (_w.y < 0) _w.negate();
    const big = ro * 4;
    ctx.beginPath();
    ctx.moveTo(x + _node.x * big, y + _node.z * big);
    ctx.lineTo(x + _node.x * big + _w.x * big, y + _node.z * big + _w.z * big);
    ctx.lineTo(x - _node.x * big + _w.x * big, y - _node.z * big + _w.z * big);
    ctx.lineTo(x - _node.x * big, y - _node.z * big);
    ctx.closePath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(x, y, over.a, over.b, over.ang, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.beginPath();
  ringPath(ctx, x, y, ro, ro * k, ang);
  ringPath(ctx, x, y, ri, ri * k, ang);
  ctx.fillStyle = 'rgba(225,205,165,0.55)';
  ctx.fill('evenodd');
  ctx.restore();
}

export interface GlyphOptions {
  /** Colour of the locator ring for sub-pixel bodies. */
  locator?: string;
  sun?: BodyState;
}

/**
 * Draws a body at its true size for the given map scale (oblate, lit from the Sun, with rings).
 * Bodies smaller than a pixel or so get a fixed-size locator ring so they stay findable.
 * Returns the radius (px) to use for picking and label placement.
 */
export function drawBody(ctx: CanvasRenderingContext2D, s: BodyState, x: number, y: number, pxPerKm: number, opt: GlyphOptions = {}): number {
  const { a, b, ang } = silhouette(s, pxPerKm);
  const ringPx = s.def.rings ? s.def.rings.outer * pxPerKm : 0;
  const col = cached(s, 'lit', 1.05);
  if (a < MIN_DISC_PX && ringPx < MIN_DISC_PX) {
    ctx.strokeStyle = opt.locator ?? (s.def.kind === 'star' ? 'rgba(255,200,120,0.85)' : col);
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, LOCATOR_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(a, 1), 0, Math.PI * 2);
    ctx.fill();
    return LOCATOR_PX;
  }
  if (ringPx >= MIN_DISC_PX) drawRings(ctx, s, x, y, pxPerKm);
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(a, 0.5), Math.max(b, 0.5), ang, 0, Math.PI * 2);
  if (s.def.kind === 'star') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, a);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(0.7, '#ffe9b8');
    g.addColorStop(1, '#ffb75e');
    ctx.fillStyle = g;
  } else if (a >= 3 && opt.sun) {
    // day/night: terminator through the centre, perpendicular to the projected Sun direction
    let dx = opt.sun.pos.x - s.pos.x, dz = opt.sun.pos.z - s.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const g = ctx.createLinearGradient(x - dx * a, y - dz * a, x + dx * a, y + dz * a);
    const dark = cached(s, 'dark', 0.22);
    g.addColorStop(0, dark);
    g.addColorStop(0.46, dark);
    g.addColorStop(0.54, col);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = col;
  }
  ctx.fill();
  if (ringPx >= MIN_DISC_PX) drawRings(ctx, s, x, y, pxPerKm, { a, b, ang });
  return Math.max(a, ringPx);
}
