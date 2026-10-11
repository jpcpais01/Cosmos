import { Vector3 } from 'three';
import type { Ship } from '../ship/flight';
import type { ViewMode } from '../ship/cameraRig';
import { VIEW_MODES } from '../ship/cameraRig';
import type { WarpDrive, WarpTarget } from './warp';
import { BODY_BY_ID, systemOf } from '../sim/bodies';
import { WARP_FACTORS, type WarpFactor } from '../sim/constants';
import type { SavedLocation } from './locations';

// The last flight, saved every few seconds and when the page is hidden, so Launch picks up where the player left off.
// The ship is stored relative to the body whose space it is in, so it comes back next to the same planet or moon
// however far the bodies have moved since.

const KEY = 'cosmos.lastFlight.v1';
/** sim clock within this of the real clock counts as "real time", and resumes at the real time of the next visit */
const LIVE_MS = 60 * 60 * 1000;

type Vec3 = [number, number, number];

interface StoredTarget {
  kind: 'body' | 'point' | 'gate';
  /** body id; for a gate, the star of its system */
  id: string;
  offset?: Vec3;
  label?: string;
}

export interface LastFlight {
  savedAt: number;
  simMs: number;
  frame: string;
  rel: Vec3;
  vel: Vec3;
  quat: [number, number, number, number];
  throttle: number;
  view: ViewMode;
  factor: WarpFactor;
  target: StoredTarget | null;
}

const finite = (a: unknown, n: number): boolean =>
  Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));

function valid(f: LastFlight): boolean {
  return (
    typeof f === 'object' && f !== null &&
    Number.isFinite(f.savedAt) && Number.isFinite(f.simMs) &&
    !!BODY_BY_ID[f.frame] &&
    finite(f.rel, 3) && finite(f.vel, 3) && finite(f.quat, 4) &&
    Number.isFinite(f.throttle) &&
    VIEW_MODES.includes(f.view)
  );
}

export function loadLastFlight(): LastFlight | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as LastFlight;
    return valid(f) ? f : null;
  } catch {
    return null;
  }
}

export function clearLastFlight(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function saveLastFlight(simMs: number, ship: Ship, warp: WarpDrive, view: ViewMode): void {
  // mid-warp the ship is between stars: keep where it is, stopped, with the target set to engage again
  const moving = !warp.active;
  const t = warp.target;
  const f: LastFlight = {
    savedAt: Date.now(),
    simMs,
    frame: ship.frame.def.id,
    rel: [ship.rel.x, ship.rel.y, ship.rel.z],
    vel: moving ? [ship.vel.x, ship.vel.y, ship.vel.z] : [0, 0, 0],
    quat: [ship.quat.x, ship.quat.y, ship.quat.z, ship.quat.w],
    throttle: moving ? ship.throttle : 0,
    view,
    factor: warp.factor,
    target: !t ? null
      : t.kind === 'body' ? { kind: 'body', id: t.id }
      : t.kind === 'gate' ? { kind: 'gate', id: ship.frame.def.id }
      : { kind: 'point', id: t.frame, offset: [t.offset.x, t.offset.y, t.offset.z], label: t.label },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* storage full or unavailable */
  }
}

/**
 * The saved flight as a location to jump to. Real-time flights resume at the current time (the bodies have moved on,
 * the ship with them); flights in another epoch or sped-up time resume at the moment they were saved.
 */
export function lastFlightLocation(f: LastFlight): SavedLocation {
  const live = Math.abs(f.simMs - f.savedAt) < LIVE_MS;
  return {
    id: 'last-flight',
    name: 'Where you left off',
    description: '',
    epoch: live ? Date.now() : f.simMs,
    system: systemOf(f.frame),
    place(eph, ship) {
      ship.frame = eph.get(f.frame);
      ship.rel.set(...f.rel);
      ship.vel.set(0, 0, 0);
      ship.angVel.set(0, 0, 0);
      ship.throttle = 0;
      ship.quat.set(...f.quat).normalize();
      ship.updateEnvironment();
      ship.collide();
    },
  };
}

/** Speed and throttle are given back at launch, so the ship holds still behind the title screen. */
export function resumeMotion(f: LastFlight, ship: Ship): void {
  ship.vel.set(...f.vel);
  ship.throttle = Math.min(1, Math.max(-1, f.throttle));
}

export function lastFlightTarget(f: LastFlight): { target: WarpTarget | null; factor: WarpFactor } {
  const factor = (WARP_FACTORS as readonly number[]).includes(f.factor) ? f.factor : 10;
  const t = f.target;
  let target: WarpTarget | null = null;
  if (t && BODY_BY_ID[t.id]) {
    if (t.kind === 'body') target = { kind: 'body', id: t.id };
    else if (t.kind === 'gate') target = systemOf(t.id) === systemOf(f.frame) ? { kind: 'gate' } : null;
    else if (finite(t.offset, 3)) target = { kind: 'point', frame: t.id, offset: new Vector3(...t.offset!), label: t.label };
  }
  return { target, factor };
}
