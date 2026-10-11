import { WARP_FACTORS, type WarpFactor } from '../sim/constants';
import type { SavedLocation } from '../game/locations';
import { fmtDate, fmtDistance, fmtDuration, fmtSpeed } from './format';
import type { ProfileReport } from '../render/profiler';
import { REVERSE_FRACTION } from '../ship/flight';

/** What the performance breakdown shows besides the frame rate. */
export interface PerfInfo {
  report: ProfileReport;
  quality: Quality;
  width: number;
  height: number;
  gpu: string;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: Quality;
  invertY: boolean;
  sensitivity: number;
  labels: boolean;
  fps: boolean;
  /** 3D scanner in the corner of the HUD */
  minimap: boolean;
  /** per-pass cost breakdown under the FPS counter */
  perf: boolean;
  sound: boolean;
  volume: number;
  /** cockpit field of view in degrees; the chase views sit 12° narrower */
  fov: number;
  /** render resolution as a share of the screen's native pixels; 'auto' lets the quality tier and frame rate decide */
  resolution: 'auto' | number;
}

/** Fixed render resolutions offered in Settings, as a share of the screen's native pixels. */
export const RESOLUTION_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SETTINGS_KEY = 'cosmos.settings.v1';

export function defaultQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse || mem <= 4) return 'medium';
  return 'high';
}

export function loadSettings(): Settings {
  const d: Settings = { quality: defaultQuality(), invertY: false, sensitivity: 1, labels: true, fps: true, minimap: true, perf: true, sound: true, volume: 0.7, fov: 72, resolution: 'auto' };
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
  refreshApp(): void;
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
  refresh: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none"/><path d="M18.5 3.5v4h-4" fill="none"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>',
};

/** Phones and tablets get the thumb-driven touch layout. */
const TOUCH = matchMedia('(pointer: coarse)').matches;

/** A button that is "on" while held down (touch controls). */
function hold(b: HTMLElement, set: (on: boolean) => void): void {
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture(e.pointerId);
    b.classList.add('on');
    set(true);
  });
  const off = () => {
    b.classList.remove('on');
    set(false);
  };
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

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
  private fpsEl = el('div', 'fps');
  private fpsLine = el('div', 'fps-line');
  private perfEl = el('div', 'perf');
  /** On touch screens the breakdown would cover the flight controls: it starts closed every session. */
  private perfTouchOpen = false;
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
  private aimEl = el('div', 'aim hidden');
  private modeEl = el('div', 'mouse-mode');
  readonly locPanel = el('div', 'panel modal hidden');
  readonly settingsPanel = el('div', 'panel modal hidden');
  readonly helpPanel = el('div', 'panel modal hidden');
  private soundBtn: HTMLButtonElement;
  private updateBtn: HTMLButtonElement;
  private moreBtn: HTMLButtonElement;
  private factorCycle: HTMLButtonElement;
  private labelsBtn: HTMLButtonElement;
  private fpsCheck?: HTMLInputElement;
  private minimapCheck?: HTMLInputElement;
  readonly touch = el('div', 'touch hidden');
  stick = { x: 0, y: 0 };
  touchThrottle: number | null = null;
  touchRoll = 0;
  touchBoost = false;
  touchBrake = false;
  private thrText = el('div', 'tthr-text', '0%');
  /** the touch throttle's last value (-1..1); the slider sets its size and REV its sign */
  private touchThr = 0;
  private revBtn = el('button', 'btn pedal rev', 'REV');
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
    this.fpsEl.append(this.fpsLine, this.perfEl);
    this.fpsEl.title = 'Click to show or hide the cost breakdown';
    this.fpsEl.onclick = () => {
      if (this.isTouch) {
        this.perfTouchOpen = !this.perfVisible;
        if (this.perfTouchOpen) this.settings.perf = true;
      } else this.settings.perf = !this.settings.perf;
      this.refreshPerf();
      saveSettings(this.settings);
    };
    tl.append(this.locName, this.locSub, this.dateEl, timeRow, this.fpsEl);

    // top-right toolbar
    const tr = el('div', 'hud-tr');
    this.soundBtn = btn(ICONS.sound, 'Sound on/off', () => this.toggle('sound'), 'btn icon');
    this.labelsBtn = btn(ICONS.tag, 'Labels on/off (T)', () => this.toggle('labels'), 'btn icon');
    this.updateBtn = btn(ICONS.refresh, 'Update and reload the app', () => actions.refreshApp(), 'btn icon');
    // on touch screens the less used buttons fold into a menu behind the "more" button
    const more = el('div', 'tr-more');
    more.append(
      this.labelsBtn,
      this.soundBtn,
      btn(ICONS.gear, 'Settings', () => this.showPanel(this.settingsPanel), 'btn icon'),
      btn(ICONS.help, 'Controls (H)', () => this.showPanel(this.helpPanel), 'btn icon'),
      this.updateBtn,
      btn(ICONS.full, 'Fullscreen (F)', () => actions.fullscreen(), 'btn icon'),
    );
    // touch: name each button, since there is no hover tooltip to say what it does
    const names = ['Labels', 'Sound', 'Settings', 'Controls', 'Update', 'Fullscreen'];
    [...more.children].forEach((b, i) => b.append(el('span', 'btn-name', names[i])));
    // capture phase: the buttons stop their clicks from bubbling
    more.addEventListener('click', () => tr.classList.remove('open'), true);
    // a tap anywhere else closes the menu too
    window.addEventListener('pointerdown', (e) => {
      if (tr.classList.contains('open') && !tr.contains(e.target as Node)) tr.classList.remove('open');
    }, true);
    this.moreBtn = btn(ICONS.more, 'More', () => tr.classList.toggle('open'), 'btn icon more');
    tr.append(
      btn(ICONS.map, 'Solar system map (M)', () => actions.toggleMap(), 'btn icon'),
      btn(ICONS.pin, 'Saved locations (L)', () => this.showPanel(this.locPanel), 'btn icon'),
      btn(ICONS.eye, 'Change view (V)', () => actions.cycleView(), 'btn icon'),
      more,
      this.moreBtn,
    );

    // bottom-centre: speed
    const bc = el('div', 'hud-bc');
    const thr = el('div', 'thr');
    thr.append(this.thrFill);
    bc.append(this.speedEl, thr, this.limitEl, this.modeEl);
    this.setMouseFlight(false);

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
      else if (TOUCH && !this.lastState?.targetName) actions.toggleMap();
      else actions.engage();
    }, 'btn primary engage');
    if (TOUCH) {
      // tapping the destination opens the map to pick one
      for (const e of [this.warpTarget, this.warpEta]) e.addEventListener('click', () => actions.toggleMap());
    }
    // touch layout: one chip cycles the warp factor next to the engage button
    this.factorCycle = btn('10c', 'Warp factor', () => {
      const cur = this.lastState?.warpFactor ?? WARP_FACTORS[2];
      actions.setFactor(WARP_FACTORS[(WARP_FACTORS.indexOf(cur) + 1) % WARP_FACTORS.length]);
    }, 'btn factor-cycle');
    const row = el('div', 'warp-row');
    row.append(this.factorCycle, this.engageBtn);
    br.append(head, this.warpTarget, this.warpEta, factors, row);

    this.marker.append(this.markerLabel);
    this.root.append(this.labelLayer, this.reticle, this.aimEl, this.marker, this.arrow, tl, tr, bc, br, this.status, this.toastEl);
    this.buildSettings();
    this.buildHelp();
    this.buildTouch();
    this.root.append(this.locPanel, this.settingsPanel, this.helpPanel, this.touch);
    this.refreshPerf();
    this.refreshToggles();
  }

  toggle(k: 'sound' | 'labels' | 'fps' | 'minimap'): void {
    this.settings[k] = !this.settings[k];
    this.refreshToggles();
    saveSettings(this.settings);
    this.actions.settingsChanged(this.settings);
  }

  refreshToggles(): void {
    this.soundBtn.classList.toggle('off', !this.settings.sound);
    this.labelsBtn.classList.toggle('off', !this.settings.labels);
    this.labelLayer.style.display = this.settings.labels ? '' : 'none';
    this.fpsEl.style.display = this.settings.fps ? '' : 'none';
    if (this.fpsCheck) this.fpsCheck.checked = this.settings.fps;
    this.root.classList.toggle('no-minimap', !this.settings.minimap);
    if (this.minimapCheck) this.minimapCheck.checked = this.settings.minimap;
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
    const res = el('select');
    const resOpts: [HTMLOptionElement, number][] = [];
    const auto = el('option', '', 'Auto (set by quality and frame rate)');
    auto.value = 'auto';
    res.append(auto);
    for (const k of RESOLUTION_SCALES) {
      const o = el('option');
      o.value = String(k);
      res.append(o);
      resOpts.push([o, k]);
    }
    // label each choice with the pixel size it renders at on this screen
    const resLabels = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const [o, k] of resOpts) {
        o.textContent = `${Math.round(k * 100)}% · ${Math.round(window.innerWidth * dpr * k)}×${Math.round(window.innerHeight * dpr * k)}`;
      }
    };
    resLabels();
    window.addEventListener('resize', resLabels);
    res.value = String(s.resolution);
    if (res.selectedIndex < 0) res.value = 'auto';
    res.onchange = () => {
      s.resolution = res.value === 'auto' ? 'auto' : Number(res.value);
      this.commit();
    };
    row('Resolution', res);
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
    const fov = el('input');
    fov.type = 'range';
    fov.min = '50';
    fov.max = '110';
    fov.step = '1';
    fov.value = String(s.fov);
    const fovLabel = () => `Field of view (${s.fov}°)`;
    fov.oninput = () => {
      s.fov = Number(fov.value);
      fovName.textContent = fovLabel();
      this.commit();
    };
    row(fovLabel(), fov);
    const fovName = fov.previousElementSibling as HTMLElement;
    const inv = el('input');
    inv.type = 'checkbox';
    inv.checked = s.invertY;
    inv.onchange = () => {
      s.invertY = inv.checked;
      this.commit();
    };
    row('Invert pitch', inv);
    const fps = el('input');
    fps.type = 'checkbox';
    fps.checked = s.fps;
    fps.onchange = () => this.toggle('fps');
    this.fpsCheck = fps;
    row('Show FPS counter', fps);
    const mini = el('input');
    mini.type = 'checkbox';
    mini.checked = s.minimap;
    mini.onchange = () => this.toggle('minimap');
    this.minimapCheck = mini;
    row('Show minimap', mini);
    const perf = el('input');
    perf.type = 'checkbox';
    perf.checked = s.perf;
    perf.onchange = () => {
      s.perf = perf.checked;
      this.perfTouchOpen = s.perf;
      this.refreshPerf();
      this.commit();
    };
    row('Show cost breakdown under FPS', perf);
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
    const touchRows: [string, string][] = [
      ['Left thumb', 'Steer: touch anywhere low on the left and drag'],
      ['Drag the view', 'Look around (cockpit) / orbit camera (outside) · double-tap to look ahead again'],
      ['THR', 'Slide up / down for speed (logarithmic, 10 m/s → 15,000 km/s)'],
      ['BOOST', 'Hold for extra speed'],
      ['BRAKE', 'Hold to slow down'],
      ['REV', 'Tap to fly backwards (half speed) · tap again for forward'],
      ['Roll buttons', 'Hold to roll left / right'],
      ['Destination', 'Tap it (or the map button) to choose a body or any point'],
      ['10c', 'Tap to change the warp factor: 1c, 3c, 10c, 50c, 100c'],
      ['ENGAGE', 'Jump to warp · tap again to drop out'],
      ['•••', 'Labels, sound, settings, controls, update, fullscreen'],
    ];
    const rows: [string, string][] = TOUCH ? touchRows : [
      ['W / S', 'Throttle up / down (logarithmic, 10 m/s → 15,000 km/s) · S again from zero flies backwards at half speed'],
      ['A / D · ← →', 'Yaw'],
      ['↑ ↓', 'Pitch'],
      ['Q / E', 'Roll'],
      ['Shift', 'Boost'],
      ['X', 'Brake (throttle to zero, forward or reverse)'],
      ['Right-click', 'Mouse flight on / off: the ship smoothly follows the mouse; off gives you the pointer back for buttons'],
      ['Left-drag', 'Look around (cockpit) / orbit camera (outside)'],
      ['V', 'Cockpit → chase → far chase view'],
      ['M', 'Solar system map: pick a body or any coordinates'],
      ['1 – 5', 'Warp factor 1c, 3c, 10c, 50c, 100c'],
      ['J', 'Engage warp / drop out'],
      ['L', 'Saved locations'],
      ['T', 'Toggle labels'],
      ['G', 'Toggle the FPS counter'],
      ['N', 'Toggle the minimap: nearby bodies around the ship in 3D, log distance, stalks show above or below your wings'],
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
    document.body.classList.add('touch-ui');
    this.touch.classList.remove('hidden');

    // flight stick: touch anywhere in the lower left and the stick centres under your thumb
    const zone = el('div', 'stick-zone');
    const pad = el('div', 'stick');
    const knob = el('div', 'knob');
    pad.append(knob);
    zone.append(pad);
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const R = 58; // stick radius in CSS px
    const set = (e: PointerEvent) => {
      let x = (e.clientX - cx) / R;
      let y = (e.clientY - cy) / R;
      const l = Math.max(1, Math.hypot(x, y));
      x /= l;
      y /= l;
      knob.style.transform = `translate(${x * (R - 22)}px, ${y * (R - 22)}px)`;
      // a small dead zone so a resting thumb doesn't drift, then a gentle curve for fine aiming
      const m = Math.hypot(x, y);
      const k = m < 0.08 ? 0 : Math.pow((m - 0.08) / 0.92, 1.35) / m;
      this.stick.x = x * k;
      this.stick.y = y * k;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      cx = Math.min(Math.max(e.clientX, r.left + R), r.right - R);
      cy = Math.min(Math.max(e.clientY, r.top + R), r.bottom - R);
      pad.style.left = `${cx - r.left - R}px`;
      pad.style.top = `${cy - r.top - R}px`;
      pad.classList.add('active');
      set(e);
    });
    zone.addEventListener('pointermove', (e) => e.pointerId === id && set(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
      pad.style.left = pad.style.top = '';
      pad.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // roll buttons, held down to roll
    const rolls = el('div', 'troll');
    const rl = el('button', 'btn roll', '<svg viewBox="0 0 24 24"><path d="M8 6.5A8 8 0 1 0 17.5 7" fill="none"/><path d="M8.5 2.5 8 6.5l4 .8" fill="none"/></svg>');
    const rr = el('button', 'btn roll', '<svg viewBox="0 0 24 24"><path d="M16 6.5A8 8 0 1 1 6.5 7" fill="none"/><path d="M15.5 2.5 16 6.5l-4 .8" fill="none"/></svg>');
    rl.title = 'Roll left';
    rr.title = 'Roll right';
    for (const [b, v] of [[rl, 1], [rr, -1]] as const) {
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        this.touchRoll = v;
        b.classList.add('on');
      });
      const stop = () => {
        this.touchRoll = 0;
        b.classList.remove('on');
      };
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
    }
    rolls.append(rl, rr);

    // throttle: a tall slider for the right thumb
    const thr = el('div', 'tthr');
    const fill = el('div', 'tthr-fill');
    const mark = el('div', 'tthr-label', 'THR');
    thr.append(fill, mark, this.thrText);
    let tid: number | null = null;
    const setT = (e: PointerEvent) => {
      const r = thr.getBoundingClientRect();
      const m = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
      const v = this.touchThr < 0 || (this.touchThr === 0 && this.revBtn.classList.contains('on')) ? -m : m;
      this.touchThrottle = v;
      this.syncTouchThrottle(v);
    };
    thr.addEventListener('pointerdown', (e) => {
      tid = e.pointerId;
      thr.setPointerCapture(e.pointerId);
      setT(e);
    });
    thr.addEventListener('pointermove', (e) => e.pointerId === tid && setT(e));
    const tend = (e: PointerEvent) => e.pointerId === tid && (tid = null);
    thr.addEventListener('pointerup', tend);
    thr.addEventListener('pointercancel', tend);

    // boost and brake, held down, beside the top of the throttle
    const pedals = el('div', 'tpedals');
    const boost = el('button', 'btn pedal', 'BOOST');
    const brake = el('button', 'btn pedal brake', 'BRAKE');
    hold(boost, (on) => (this.touchBoost = on));
    hold(brake, (on) => (this.touchBrake = on));
    // reverse: tap to flip the throttle between forward and reverse
    const rev = this.revBtn;
    rev.title = 'Reverse (half speed)';
    rev.addEventListener('contextmenu', (e) => e.preventDefault());
    rev.addEventListener('click', () => {
      const on = !rev.classList.contains('on');
      const v = (on ? -1 : 1) * Math.abs(this.touchThr);
      this.touchThrottle = v;
      this.syncTouchThrottle(v);
      rev.classList.toggle('on', on);
    });
    pedals.append(boost, brake, rev);
    this.touch.append(zone, rolls, thr, pedals);
  }

  /** Called when the throttle is changed by other inputs so the touch slider follows. */
  syncTouchThrottle(v: number): void {
    this.touchThr = v;
    if (v !== 0) this.revBtn.classList.toggle('on', v < 0);
    const fill = this.touch.querySelector<HTMLDivElement>('.tthr-fill');
    if (fill) {
      fill.style.height = `${Math.abs(v) * 100}%`;
      fill.classList.toggle('rev', v < 0 || (v === 0 && this.revBtn.classList.contains('on')));
    }
    this.thrText.textContent = `${v < 0 ? 'R ' : ''}${Math.round(Math.abs(v) * 100)}%`;
  }

  /** A newer version has been downloaded: highlight the update button. */
  setUpdateReady(): void {
    if (this.updateBtn.classList.contains('ready')) return;
    this.updateBtn.classList.add('ready');
    this.moreBtn.classList.add('ready');
    this.updateBtn.title = 'A new version is ready: click to load it';
    this.toast('A new version of Cosmos is ready. Use the glowing update button to load it.', 6000);
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
    const rev = !warping && s.throttle < 0;
    this.limitEl.textContent = warping ? `WARP ${s.warpFactor}c` : `${rev ? 'REVERSE · ' : ''}${s.boost ? 'BOOST · ' : ''}LIMIT ${fmtSpeed(s.limit * (rev ? REVERSE_FRACTION : 1))}`;
    this.thrFill.style.width = `${(warping ? 1 : Math.abs(s.throttle)) * 100}%`;
    this.thrFill.classList.toggle('warp', warping);
    this.thrFill.classList.toggle('rev', rev);
    this.locName.textContent = s.nearest.toUpperCase();
    this.locSub.textContent = `${s.nearest === 'Interplanetary space' ? 'From the Sun' : 'Altitude'} ${fmtDistance(s.altitude)} · ${s.view}`;
    this.dateEl.textContent = fmtDate(s.simMs);
    this.scaleEl.textContent = s.timeScale === 0 ? 'PAUSED' : s.timeScale === 1 ? 'REAL TIME' : `×${s.timeScale.toLocaleString('en-US')}`;
    for (const [f, b] of this.factorBtns) b.classList.toggle('on', f === s.warpFactor);
    const fl = `${s.warpFactor}c`;
    if (this.factorCycle.textContent !== fl) this.factorCycle.textContent = fl;
    if (s.targetName) {
      this.warpTarget.textContent = s.targetName;
      this.warpEta.textContent = `${fmtDistance(s.targetDistance)} · ETA ${fmtDuration(s.targetEta)}`;
    } else {
      this.warpTarget.textContent = 'No destination';
      this.warpEta.textContent = TOUCH ? 'Tap here to choose one on the map' : 'Open the map (M) to choose one';
    }
    const active = s.warpState !== 'idle';
    this.engageBtn.textContent = active ? (s.warpState === 'cruise' ? 'DROP OUT' : 'ABORT') : 'ENGAGE';
    this.engageBtn.classList.toggle('danger', active);
    this.engageBtn.disabled = !TOUCH && !s.targetName && !active;
    this.engageBtn.classList.toggle('idle', !s.targetName && !active);
    let st = '';
    if (s.warpState === 'aligning') st = 'ALIGNING TO TARGET';
    else if (s.warpState === 'spooling') st = `WARP DRIVE CHARGING ${Math.round(s.warpSpool * 100)}%`;
    else if (s.warpState === 'cruise') st = `WARP ${s.warpFactor}c · ${s.targetName} · ${fmtDuration(s.warpDistance / (s.warpFactor * 299792.458))}`;
    else if (s.warpState === 'exiting') st = 'DROPPING OUT OF WARP';
    this.status.textContent = st;
    this.status.classList.toggle('show', !!st);
  }

  /** Frame-rate readout: frames per second, mean frame time and the dynamic render scale, plus the cost breakdown. */
  setFps(fps: number, ms: number, renderScale: number, perf: PerfInfo | null): void {
    if (!this.settings.fps) return;
    const res = renderScale < 0.999 ? ` · RES ${Math.round(renderScale * 100)}%` : '';
    this.fpsLine.textContent = `${Math.round(fps)} FPS · ${ms.toFixed(1)} ms${res}`;
    this.fpsEl.classList.toggle('warn', fps < 50 && fps >= 28);
    this.fpsEl.classList.toggle('bad', fps < 28);
    if (perf && this.perfVisible) this.perfEl.innerHTML = this.perfHtml(perf, ms);
  }

  private get isTouch(): boolean {
    return document.body.classList.contains('touch-ui');
  }

  /** Whether the cost breakdown is on screen (and so worth measuring). */
  get perfVisible(): boolean {
    return this.settings.fps && this.settings.perf && (!this.isTouch || this.perfTouchOpen);
  }

  private refreshPerf(): void {
    this.perfEl.style.display = this.perfVisible ? '' : 'none';
  }

  private perfHtml(p: PerfInfo, frameMs: number): string {
    const r = p.report;
    // bars are scaled to the frame time, so the longest bar shows where the frame goes
    const scale = Math.max(frameMs, r.gpuTotal, r.cpuTotal, 1);
    const row = (name: string, v: number, cls = '') =>
      `<div class="pr ${cls}"><span class="pn">${esc(name)}</span><span class="pv">${v.toFixed(2)}</span>` +
      `<span class="pb"><i style="width:${Math.min(100, (v / scale) * 100).toFixed(1)}%"></i></span></div>`;
    let h = `<div class="ph">${p.quality.toUpperCase()} · ${p.width}×${p.height} · ${Math.round(r.calls)} draws · ${(r.triangles / 1000).toFixed(0)}k tris</div>`;
    if (p.gpu) h += `<div class="ph dim">${esc(p.gpu)}</div>`;
    if (r.gpuTimers) {
      h += `<div class="ps">GPU <b>${r.gpuTotal.toFixed(2)} ms</b></div>`;
      for (const [k, v] of r.gpu) h += row(k, v, 'g');
    } else h += '<div class="ps dim">GPU timers not available in this browser</div>';
    h += `<div class="ps">CPU <b>${r.cpuTotal.toFixed(2)} ms</b></div>`;
    for (const [k, v] of r.cpu) h += row(k, v, 'c');
    const busy = Math.max(r.gpuTotal, r.cpuTotal);
    const verdict = !r.gpuTimers ? '' : r.gpuTotal > r.cpuTotal * 1.2 && r.gpuTotal > frameMs * 0.6 ? 'Limited by the GPU'
      : r.cpuTotal > frameMs * 0.6 ? 'Limited by the CPU' : busy < frameMs * 0.6 ? 'Waiting on the display or browser' : '';
    if (verdict) h += `<div class="ph">${verdict}</div>`;
    return h;
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

  /** Shows whether the mouse is steering the ship or is a normal pointer. */
  setMouseFlight(on: boolean): void {
    this.root.classList.toggle('mouse-flight', on);
    this.modeEl.classList.toggle('on', on);
    this.modeEl.textContent = on ? 'MOUSE FLIGHT · right-click for pointer' : 'Right-click to steer with the mouse';
  }

  /** Mouse-flight aim point, as a CSS pixel offset from the screen centre (null hides it). */
  setAim(off: { x: number; y: number } | null): void {
    if (!off) {
      this.aimEl.classList.add('hidden');
      return;
    }
    this.aimEl.classList.remove('hidden');
    this.aimEl.style.transform = `translate(${off.x}px, ${off.y}px)`;
  }
}
