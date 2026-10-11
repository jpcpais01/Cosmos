import { WARP_FACTORS, type WarpFactor } from '../sim/constants';
import type { SavedLocation } from '../game/locations';
import { fmtDate, fmtDistance, fmtDuration, fmtSpeed } from './format';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: Quality;
  invertY: boolean;
  sensitivity: number;
  labels: boolean;
  sound: boolean;
  volume: number;
}

const SETTINGS_KEY = 'cosmos.settings.v1';

export function defaultQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse || mem <= 4) return 'medium';
  return 'high';
}

export function loadSettings(): Settings {
  const d: Settings = { quality: defaultQuality(), invertY: false, sensitivity: 1, labels: true, sound: true, volume: 0.7 };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return d;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface HudActions {
  toggleMap(): void;
  cycleView(): void;
  setFactor(f: WarpFactor): void;
  engage(): void;
  abort(): void;
  timeFaster(): void;
  timeSlower(): void;
  timePause(): void;
  timeNow(): void;
  goLocation(l: SavedLocation): void;
  saveLocation(name: string): void;
  deleteLocation(id: string): void;
  settingsChanged(s: Settings): void;
  fullscreen(): void;
  clearTarget(): void;
}

export interface HudState {
  speed: number;
  limit: number;
  throttle: number;
  altitude: number;
  nearest: string;
  frame: string;
  simMs: number;
  timeScale: number;
  warpState: string;
  warpFactor: WarpFactor;
  warpSpool: number;
  warpSpeed: number;
  warpDistance: number;
  targetName: string;
  targetDistance: number;
  targetEta: number;
  view: string;
  boost: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function btn(label: string, title: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    (e.currentTarget as HTMLButtonElement).blur();
  });
  return b;
}

const ICONS = {
  map: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6" fill="none"/><circle cx="12" cy="12" r="9.6" fill="none" stroke-dasharray="2 2.4"/><circle cx="17.2" cy="9" r="1.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-6.2-6-11a6 6 0 1 1 12 0c0 4.8-6 11-6 11z" fill="none"/><circle cx="12" cy="10" r="2.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none"/><circle cx="12" cy="12" r="3"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z" fill="none"/><circle cx="7.5" cy="8.5" r="1.4"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" fill="none"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1 1-1.1 1.8v.6" fill="none"/><circle cx="12" cy="17.3" r=".9"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none"/></svg>',
};

/** DOM heads-up display, menus and touch controls. */
export class Hud {
  readonly root = el('div', 'hud');
  private speedEl = el('div', 'speed-value');
  private limitEl = el('div', 'speed-limit');
  private thrFill = el('div', 'thr-fill');
  private locName = el('div', 'loc-name');
  private locSub = el('div', 'loc-sub');
  private dateEl = el('div', 'date');
  private scaleEl = el('div', 'tscale');
  private warpTarget = el('div', 'warp-target');
  private warpEta = el('div', 'warp-eta');
  private factorBtns = new Map<WarpFactor, HTMLButtonElement>();
  private engageBtn: HTMLButtonElement;
  private status = el('div', 'warp-status');
  private toastEl = el('div', 'toast');
  private toastTimer = 0;
  private marker = el('div', 'target-marker hidden');
  private markerLabel = el('div', 'tm-label');
  private arrow = el('div', 'target-arrow hidden');
  private labels: HTMLDivElement[] = [];
  private labelLayer = el('div', 'labels');
  private reticle = el('div', 'reticle');
  readonly locPanel = el('div', 'panel modal hidden');
  readonly settingsPanel = el('div', 'panel modal hidden');
  readonly helpPanel = el('div', 'panel modal hidden');
  private soundBtn: HTMLButtonElement;
  private labelsBtn: HTMLButtonElement;
  readonly touch = el('div', 'touch hidden');
  stick = { x: 0, y: 0 };
  touchThrottle: number | null = null;
  touchRoll = 0;
  private lastState?: HudState;

  constructor(private actions: HudActions, private settings: Settings) {
    // top-left: location & time
    const tl = el('div', 'hud-tl');
    const timeRow = el('div', 'time-row');
    timeRow.append(
      btn('«', 'Slower time ( , )', () => actions.timeSlower(), 'btn small'),
      btn('❚❚', 'Pause / resume time (P)', () => actions.timePause(), 'btn small'),
      btn('»', 'Faster time ( . )', () => actions.timeFaster(), 'btn small'),
      btn('NOW', 'Back to the real current time', () => actions.timeNow(), 'btn small'),
      this.scaleEl,
    );
    tl.append(this.locName, this.locSub, this.dateEl, timeRow);

    // top-right toolbar
    const tr = el('div', 'hud-tr');
    this.soundBtn = btn(ICONS.sound, 'Sound on/off', () => this.toggle('sound'), 'btn icon');
    this.labelsBtn = btn(ICONS.tag, 'Labels on/off (T)', () => this.toggle('labels'), 'btn icon');
    tr.append(
      btn(ICONS.map, 'Solar system map (M)', () => actions.toggleMap(), 'btn icon'),
      btn(ICONS.pin, 'Saved locations (L)', () => this.showPanel(this.locPanel), 'btn icon'),
      btn(ICONS.eye, 'Change view (V)', () => actions.cycleView(), 'btn icon'),
      this.labelsBtn,
      this.soundBtn,
      btn(ICONS.gear, 'Settings', () => this.showPanel(this.settingsPanel), 'btn icon'),
      btn(ICONS.help, 'Controls (H)', () => this.showPanel(this.helpPanel), 'btn icon'),
      btn(ICONS.full, 'Fullscreen (F)', () => actions.fullscreen(), 'btn icon'),
    );

    // bottom-centre: speed
    const bc = el('div', 'hud-bc');
    const thr = el('div', 'thr');
    thr.append(this.thrFill);
    bc.append(this.speedEl, thr, this.limitEl);

    // bottom-right: warp
    const br = el('div', 'hud-br panel');
    const head = el('div', 'warp-head', 'WARP DRIVE');
    const clear = btn('✕', 'Clear target', () => actions.clearTarget(), 'btn tiny');
    head.append(clear);
    const factors = el('div', 'factors');
    for (const f of WARP_FACTORS) {
      const b = btn(`${f}c`, `Warp factor ${f}× light speed (${WARP_FACTORS.indexOf(f) + 1})`, () => actions.setFactor(f), 'btn factor');
      this.factorBtns.set(f, b);
      factors.append(b);
    }
    this.engageBtn = btn('ENGAGE', 'Engage warp (J)', () => {
      if (this.lastState && this.lastState.warpState !== 'idle') actions.abort();
      else actions.engage();
    }, 'btn primary engage');
    br.append(head, this.warpTarget, this.warpEta, factors, this.engageBtn);

    this.marker.append(this.markerLabel);
    this.root.append(this.labelLayer, this.reticle, this.marker, this.arrow, tl, tr, bc, br, this.status, this.toastEl);
    this.buildSettings();
    this.buildHelp();
    this.buildTouch();
    this.root.append(this.locPanel, this.settingsPanel, this.helpPanel, this.touch);
    this.refreshToggles();
  }

  private toggle(k: 'sound' | 'labels'): void {
    this.settings[k] = !this.settings[k];
    this.refreshToggles();
    saveSettings(this.settings);
    this.actions.settingsChanged(this.settings);
  }

  refreshToggles(): void {
    this.soundBtn.classList.toggle('off', !this.settings.sound);
    this.labelsBtn.classList.toggle('off', !this.settings.labels);
    this.labelLayer.style.display = this.settings.labels ? '' : 'none';
  }

  showPanel(p: HTMLElement): void {
    const was = !p.classList.contains('hidden');
    this.closePanels();
    if (!was) p.classList.remove('hidden');
  }

  closePanels(): boolean {
    let any = false;
    for (const p of [this.locPanel, this.settingsPanel, this.helpPanel]) {
      if (!p.classList.contains('hidden')) any = true;
      p.classList.add('hidden');
    }
    return any;
  }

  get panelOpen(): boolean {
    return [this.locPanel, this.settingsPanel, this.helpPanel].some((p) => !p.classList.contains('hidden'));
  }

  buildLocations(defaults: SavedLocation[], custom: SavedLocation[]): void {
    const p = this.locPanel;
    p.innerHTML = '';
    const head = el('div', 'panel-head', 'SAVED LOCATIONS');
    head.append(btn('✕', 'Close', () => this.closePanels(), 'btn tiny'));
    p.append(head);
    const list = el('div', 'loc-list');
    const add = (l: SavedLocation) => {
      const row = el('button', 'loc-item');
      row.append(el('div', 'loc-title', l.name), el('div', 'loc-desc', l.description));
      row.onclick = () => {
        this.closePanels();
        this.actions.goLocation(l);
      };
      if (l.custom) {
        const del = btn('✕', 'Delete', () => this.actions.deleteLocation(l.id), 'btn tiny del');
        row.append(del);
      }
      list.append(row);
    };
    defaults.forEach(add);
    if (custom.length) list.append(el('div', 'sep', 'YOUR LOCATIONS'));
    custom.forEach(add);
    p.append(list);
    const form = el('form', 'loc-save');
    const input = el('input');
    input.placeholder = 'Name this view…';
    input.maxLength = 40;
    form.append(input, el('button', 'btn', 'SAVE HERE'));
    form.onsubmit = (e) => {
      e.preventDefault();
      this.actions.saveLocation(input.value.trim() || 'My location');
      input.value = '';
    };
    p.append(form);
  }

  private buildSettings(): void {
    const p = this.settingsPanel;
    const head = el('div', 'panel-head', 'SETTINGS');
    head.append(btn('✕', 'Close', () => this.closePanels(), 'btn tiny'));
    p.append(head);
    const s = this.settings;
    const row = (label: string, ctl: HTMLElement) => {
      const r = el('label', 'set-row');
      r.append(el('span', '', label), ctl);
      p.append(r);
    };
    const q = el('select');
    for (const [v, n] of [['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra (8K maps)']]) {
      const o = el('option', '', n);
      o.value = v;
      q.append(o);
    }
    q.value = s.quality;
    q.onchange = () => {
      s.quality = q.value as Quality;
      this.commit();
    };
    row('Graphics quality', q);
    const sens = el('input');
    sens.type = 'range';
    sens.min = '0.3';
    sens.max = '2.5';
    sens.step = '0.1';
    sens.value = String(s.sensitivity);
    sens.oninput = () => {
      s.sensitivity = Number(sens.value);
      this.commit();
    };
    row('Mouse sensitivity', sens);
    const inv = el('input');
    inv.type = 'checkbox';
    inv.checked = s.invertY;
    inv.onchange = () => {
      s.invertY = inv.checked;
      this.commit();
    };
    row('Invert pitch', inv);
    const vol = el('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(s.volume);
    vol.oninput = () => {
      s.volume = Number(vol.value);
      this.commit();
    };
    row('Volume', vol);
  }

  private commit(): void {
    saveSettings(this.settings);
    this.actions.settingsChanged(this.settings);
  }

  private buildHelp(): void {
    const p = this.helpPanel;
    const head = el('div', 'panel-head', 'CONTROLS');
    head.append(btn('✕', 'Close', () => this.closePanels(), 'btn tiny'));
    p.append(head);
    const rows: [string, string][] = [
      ['W / S', 'Throttle up / down (logarithmic, 10 m/s → 15,000 km/s)'],
      ['A / D · ← →', 'Yaw'],
      ['↑ ↓', 'Pitch'],
      ['Q / E', 'Roll'],
      ['Shift', 'Boost'],
      ['X', 'Brake (throttle to zero)'],
      ['Right-click', 'Mouse flight (pointer lock) · Esc to release'],
      ['Left-drag', 'Look around (cockpit) / orbit camera (outside)'],
      ['V', 'Cockpit → chase → far chase view'],
      ['M', 'Solar system map: pick a body or any coordinates'],
      ['1 – 5', 'Warp factor 1c, 3c, 10c, 50c, 100c'],
      ['J', 'Engage warp / drop out'],
      ['L', 'Saved locations'],
      ['T', 'Toggle labels'],
      [', / . / P', 'Slower / faster / pause time'],
      ['F', 'Fullscreen'],
      ['H', 'This help'],
    ];
    const t = el('div', 'help-grid');
    for (const [k, v] of rows) t.append(el('kbd', '', k), el('span', '', v));
    p.append(t);
    p.append(el('p', 'muted small', 'Everything is to scale: real planet sizes, distances and positions for the current date, real star catalogue (Hipparcos). Warp travels at real multiples of light speed, so a trip to Neptune takes minutes even at 100c.'));
  }

  private buildTouch(): void {
    if (!matchMedia('(pointer: coarse)').matches) return;
    this.touch.classList.remove('hidden');
    const pad = el('div', 'stick');
    const knob = el('div', 'knob');
    pad.append(knob);
    let id: number | null = null;
    const set = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const l = Math.max(1, Math.hypot(x, y));
      this.stick.x = x / l;
      this.stick.y = y / l;
      knob.style.transform = `translate(${this.stick.x * 40}px, ${this.stick.y * 40}px)`;
    };
    pad.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      set(e);
    });
    pad.addEventListener('pointermove', (e) => e.pointerId === id && set(e));
    const end = () => {
      id = null;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);

    const thr = el('div', 'tthr');
    const fill = el('div', 'tthr-fill');
    thr.append(fill);
    const setT = (e: PointerEvent) => {
      const r = thr.getBoundingClientRect();
      const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
      this.touchThrottle = v;
      fill.style.height = `${v * 100}%`;
    };
    thr.addEventListener('pointerdown', (e) => {
      thr.setPointerCapture(e.pointerId);
      setT(e);
    });
    thr.addEventListener('pointermove', (e) => e.buttons && setT(e));
    const rolls = el('div', 'troll');
    const rl = el('button', 'btn small', '⟲');
    const rr = el('button', 'btn small', '⟳');
    for (const [b, v] of [[rl, 1], [rr, -1]] as const) {
      b.addEventListener('pointerdown', () => (this.touchRoll = v));
      b.addEventListener('pointerup', () => (this.touchRoll = 0));
      b.addEventListener('pointerleave', () => (this.touchRoll = 0));
    }
    rolls.append(rl, rr);
    this.touch.append(pad, rolls, thr);
  }

  /** Called when the throttle is changed by other inputs so the touch slider follows. */
  syncTouchThrottle(v: number): void {
    const fill = this.touch.querySelector<HTMLDivElement>('.tthr-fill');
    if (fill) fill.style.height = `${v * 100}%`;
  }

  toast(msg: string, ms = 3200): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  update(s: HudState): void {
    this.lastState = s;
    const warping = s.warpState === 'cruise';
    this.speedEl.textContent = fmtSpeed(warping ? s.warpSpeed : s.speed);
    this.limitEl.textContent = warping ? `WARP ${s.warpFactor}c` : `${s.boost ? 'BOOST · ' : ''}LIMIT ${fmtSpeed(s.limit)}`;
    this.thrFill.style.width = `${(warping ? 1 : s.throttle) * 100}%`;
    this.thrFill.classList.toggle('warp', warping);
    this.locName.textContent = s.nearest.toUpperCase();
    this.locSub.textContent = `${s.nearest === 'Interplanetary space' ? 'From the Sun' : 'Altitude'} ${fmtDistance(s.altitude)} · ${s.view}`;
    this.dateEl.textContent = fmtDate(s.simMs);
    this.scaleEl.textContent = s.timeScale === 0 ? 'PAUSED' : s.timeScale === 1 ? 'REAL TIME' : `×${s.timeScale.toLocaleString('en-US')}`;
    for (const [f, b] of this.factorBtns) b.classList.toggle('on', f === s.warpFactor);
    if (s.targetName) {
      this.warpTarget.textContent = s.targetName;
      this.warpEta.textContent = `${fmtDistance(s.targetDistance)} · ETA ${fmtDuration(s.targetEta)}`;
    } else {
      this.warpTarget.textContent = 'No destination';
      this.warpEta.textContent = 'Open the map (M) to choose one';
    }
    const active = s.warpState !== 'idle';
    this.engageBtn.textContent = active ? (s.warpState === 'cruise' ? 'DROP OUT' : 'ABORT') : 'ENGAGE';
    this.engageBtn.classList.toggle('danger', active);
    this.engageBtn.disabled = !s.targetName && !active;
    let st = '';
    if (s.warpState === 'aligning') st = 'ALIGNING TO TARGET';
    else if (s.warpState === 'spooling') st = `WARP DRIVE CHARGING ${Math.round(s.warpSpool * 100)}%`;
    else if (s.warpState === 'cruise') st = `WARP ${s.warpFactor}c · ${s.targetName} · ${fmtDuration(s.warpDistance / Math.max(s.warpSpeed, 1))}`;
    else if (s.warpState === 'exiting') st = 'DROPPING OUT OF WARP';
    this.status.textContent = st;
    this.status.classList.toggle('show', !!st);
  }

  /** Positions the target bracket; x/y in CSS px, or null when off-screen with an edge angle. */
  setMarker(vis: { x: number; y: number; r: number } | null, edge: { x: number; y: number; ang: number } | null, label: string): void {
    if (vis) {
      this.marker.classList.remove('hidden');
      const r = Math.max(14, Math.min(vis.r + 8, 400));
      this.marker.style.transform = `translate(${vis.x - r}px, ${vis.y - r}px)`;
      this.marker.style.width = this.marker.style.height = `${r * 2}px`;
      this.markerLabel.textContent = label;
    } else this.marker.classList.add('hidden');
    if (edge) {
      this.arrow.classList.remove('hidden');
      this.arrow.style.transform = `translate(${edge.x}px, ${edge.y}px) rotate(${edge.ang}rad)`;
    } else this.arrow.classList.add('hidden');
  }

  setLabels(items: { x: number; y: number; text: string; sub: string }[]): void {
    while (this.labels.length < items.length) {
      const d = el('div', 'label');
      d.append(el('b'), el('span'));
      this.labelLayer.append(d);
      this.labels.push(d);
    }
    this.labels.forEach((d, i) => {
      const it = items[i];
      if (!it) {
        d.style.display = 'none';
        return;
      }
      d.style.display = '';
      d.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px)`;
      const b = d.firstChild as HTMLElement;
      const sp = d.lastChild as HTMLElement;
      if (b.textContent !== it.text) b.textContent = it.text;
      if (sp.textContent !== it.sub) sp.textContent = it.sub;
    });
  }

  setReticle(show: boolean): void {
    this.reticle.style.display = show ? '' : 'none';
  }
}
