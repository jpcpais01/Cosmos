import { SYSTEMS, SYSTEM_BY_ID, lightYearsBetween } from '../sim/systems';
import { BODIES } from '../sim/bodies';
import type { GateJump } from '../game/gateJump';

const TOUCH = matchMedia('(pointer: coarse)').matches;

function planets(system: string): number {
  return BODIES.filter((b) => (b.system ?? 'sol') === system && b.kind === 'planet').length;
}

/**
 * The warp gate's console: opens when the ship is near a gate, lists the stars it can reach and follows
 * the jump (lining up, charging, the crossing) once one is chosen.
 */
export class GatePanel {
  readonly root = document.createElement('div');
  private head = document.createElement('div');
  private body = document.createElement('div');
  private status = document.createElement('div');
  private bar = document.createElement('div');
  private abortBtn = document.createElement('button');
  private builtFor = '';
  private shown = false;
  onJump?: (system: string) => void;
  onAbort?: () => void;

  constructor(private jump: GateJump) {
    this.root.className = 'gate-panel panel';
    this.status.className = 'gate-status';
    const track = document.createElement('div');
    track.className = 'gate-track';
    this.bar.className = 'gate-bar';
    track.append(this.bar);
    this.abortBtn.className = 'btn tiny';
    this.abortBtn.textContent = TOUCH ? 'Abort' : 'Abort (J)';
    this.abortBtn.addEventListener('click', () => this.onAbort?.());
    const live = document.createElement('div');
    live.className = 'gate-live';
    live.append(this.status, track, this.abortBtn);
    this.head.className = 'gate-head';
    this.body.className = 'gate-dests';
    this.root.append(this.head, this.body, live);
  }

  /** The first destination on the list (Enter jumps there). */
  firstDestination(system: string): string | null {
    return SYSTEMS.find((s) => s.id !== system)?.id ?? null;
  }

  private build(system: string): void {
    this.builtFor = system;
    const here = SYSTEM_BY_ID[system];
    this.head.innerHTML = `<span class="gate-ring"></span><div><b>WARP GATE</b><small>${here.name}</small></div>`;
    this.body.replaceChildren();
    const hint = document.createElement('div');
    hint.className = 'gate-hint';
    hint.textContent = 'Choose a destination';
    this.body.append(hint);
    for (const s of SYSTEMS) {
      if (s.id === system) continue;
      const b = document.createElement('button');
      b.className = 'gate-dest';
      const ly = lightYearsBetween(here, s);
      const n = planets(s.id);
      b.innerHTML = `<b>${s.name}</b><span>${Math.round(ly).toLocaleString('en-US')} light years${s.constellation ? ` · in ${s.constellation}` : ''}</span>`
        + `<span>${n} planet${n === 1 ? '' : 's'}</span><i>${TOUCH ? 'Jump' : 'Jump ⏎'}</i>`;
      b.addEventListener('click', () => this.onJump?.(s.id));
      this.body.append(b);
    }
  }

  /** @param near the ship is close enough to use the gate */
  update(system: string, near: boolean, hidden: boolean): void {
    const j = this.jump;
    const show = !hidden && (near || (j.active && j.state !== 'tunnel' && j.state !== 'exiting'));
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('show', show);
    }
    if (!show) return;
    if (this.builtFor !== system) this.build(system);
    this.root.classList.toggle('jumping', j.active);
    if (!j.active) return;
    const dest = j.dest ? SYSTEM_BY_ID[j.dest].name : '';
    let text = '';
    let p = 0;
    if (j.state === 'aligning') text = 'Lining up with the gate';
    else if (j.state === 'charging') {
      text = `Gate charging · ${Math.round(j.charge * 100)}%`;
      p = j.charge;
    } else if (j.state === 'entering') {
      text = `Jumping to ${dest}`;
      p = 1;
    }
    this.status.textContent = text;
    this.bar.style.transform = `scaleX(${p})`;
    this.abortBtn.style.visibility = j.state === 'aligning' || j.state === 'charging' ? 'visible' : 'hidden';
  }
}
