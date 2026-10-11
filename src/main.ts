import './style.css';
import {
  Color, MathUtils, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
  LinearMipmapLinearFilter, NoToneMapping,
} from 'three';
import { Ephemeris } from './sim/ephemeris';
import { AU_KM, C_KMS, DAY_MS, WARP_FACTORS, type WarpFactor } from './sim/constants';
import { Universe, SUN_COLOR } from './render/universe';
import { Sky, worldToGalactic } from './render/sky';
import { PostPipeline } from './render/post';
import { FrameProfiler } from './render/profiler';
import { EnvMap } from './render/envmap';
import { Ship, lookQuat } from './ship/flight';
import { ShipView } from './ship/shipModel';
import { CameraRig } from './ship/cameraRig';
import { WarpDrive, type WarpTarget } from './game/warp';
import { DEFAULT_LOCATIONS, deleteCustomLocation, loadCustomLocations, saveCustomLocation, type SavedLocation } from './game/locations';
import { Input } from './game/input';
import { Hud, loadSettings, saveSettings, type Quality, type Settings } from './ui/hud';
import { SystemMap } from './ui/map';
import { Mfd } from './ui/mfd';
import { Minimap } from './ui/minimap';
import { Sound } from './audio/sound';
import { fmtDistance } from './ui/format';
import { startSplashStars } from './ui/splash';
import { renderPatchNotes } from './ui/patchNotes';

const BASE = import.meta.env.BASE_URL;

declare global {
  interface Window {
    cosmos?: Record<string, unknown>;
  }
}

interface Preset {
  pixelRatio: number;
  /** FXAA on the final image (replaces MSAA, which cost far more than it gave) */
  aa: boolean;
  /** sharpening of smooth areas in the AA pass, 0..1 */
  sharpen: number;
  maxTexture: number;
  shadow: number;
  milkyWay: number;
}

const PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 0.75, aa: false, sharpen: 0, maxTexture: 2048, shadow: 1024, milkyWay: 2048 },
  medium: { pixelRatio: 1, aa: true, sharpen: 0.2, maxTexture: 4096, shadow: 2048, milkyWay: 6000 },
  high: { pixelRatio: 1.25, aa: true, sharpen: 0.3, maxTexture: 8192, shadow: 2048, milkyWay: 6000 },
  ultra: { pixelRatio: 1.5, aa: true, sharpen: 0.3, maxTexture: 8192, shadow: 2048, milkyWay: 6000 },
};

const TIME_SCALES = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000];
const VIEW_NAMES = { cockpit: 'Cockpit', chase: 'Chase camera', far: 'Far chase camera' } as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Fraction of the solar disc visible from p (soft eclipses by any body). */
function sunVisibility(eph: Ephemeris, p: Vector3): number {
  const sun = eph.get('sun');
  const toSun = _s1.subVectors(sun.pos, p);
  const ds = toSun.length();
  toSun.multiplyScalar(1 / ds);
  const rs = Math.asin(Math.min(1, sun.def.radius / ds));
  let vis = 1;
  for (const s of eph.list) {
    if (s === sun) continue;
    const to = _s2.subVectors(s.pos, p);
    const d = to.length();
    if (d > ds) continue;
    const rb = Math.asin(Math.min(1, s.def.radius / d));
    const sep = Math.acos(Math.min(1, Math.max(-1, to.dot(toSun) / d)));
    if (sep >= rs + rb) continue;
    let frac: number;
    if (sep <= Math.abs(rb - rs)) frac = rb >= rs ? 1 : (rb * rb) / (rs * rs);
    else {
      const a1 = rs * rs * Math.acos((sep * sep + rs * rs - rb * rb) / (2 * sep * rs));
      const a2 = rb * rb * Math.acos((sep * sep + rb * rb - rs * rs) / (2 * sep * rb));
      const a3 = 0.5 * Math.sqrt(Math.max(0, (-sep + rs + rb) * (sep + rs - rb) * (sep - rs + rb) * (sep + rs + rb)));
      frac = (a1 + a2 - a3) / (Math.PI * rs * rs);
    }
    vis *= 1 - Math.min(1, frac);
  }
  return vis;
}
const _s1 = new Vector3();
const ORIGIN = new Vector3();
const _s2 = new Vector3();
const _rates = new Vector3();

async function main(): Promise<void> {
  const loading = $('loading');
  const bar = $('load-bar');
  const loadText = $('load-text');
  startSplashStars($<HTMLCanvasElement>('load-stars'));
  renderPatchNotes($('patch-notes'));
  const loadPct = $('load-pct');
  if (!webglAvailable()) {
    loadText.textContent = 'This experience needs WebGL 2. Please use a recent Chrome, Edge, Firefox or Safari.';
    return;
  }
  const settings: Settings = loadSettings();
  let preset = PRESETS[settings.quality];

  const canvas = $<HTMLCanvasElement>('scene');
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.toneMapping = NoToneMapping;
  const BLACK = new Color(0, 0, 0);
  renderer.setClearColor(BLACK, 1);
  const gl = renderer.getContext();

  // --- simulation
  let simMs = Date.now();
  let timeIdx = 0;
  let paused = false;
  const eph = new Ephemeris();
  eph.update(simMs);
  const ship = new Ship(eph);
  const warp = new WarpDrive(eph, ship);

  // --- rendering
  const universe = new Universe(renderer, eph, preset.maxTexture);
  const sky = new Sky();
  const post = new PostPipeline(renderer);
  // per-pass costs for the performance readout
  const prof = new FrameProfiler(renderer);
  post.profiler = prof;
  post.setAA(preset.aa, preset.sharpen);
  const shipView = new ShipView(renderer);
  shipView.sun.shadow.mapSize.set(preset.shadow, preset.shadow);
  const env = new EnvMap(renderer, universe, eph, worldToGalactic());
  const rig = new CameraRig(new Vector3(0, 1.42, -1.62));
  const input = new Input(canvas);
  const sound = new Sound();
  const mfd = new Mfd(eph, ship, warp);

  // --- loading
  let progress = { tex: 0, stars: 0, ship: 0, sky: 0 };
  const showProgress = () => {
    const p = progress.tex * 0.55 + progress.stars * 0.15 + progress.ship * 0.2 + progress.sky * 0.1;
    bar.style.width = `${Math.round(p * 100)}%`;
    loadPct.textContent = `${Math.round(p * 100)}%`;
  };
  const loadSky = (w: number) =>
    new TextureLoader().loadAsync(`${BASE}textures/sky/milkyway_${w}.webp`).then((t) => {
      t.colorSpace = SRGBColorSpace;
      t.wrapS = RepeatWrapping;
      t.minFilter = LinearMipmapLinearFilter;
      t.anisotropy = 4;
      sky.setMilkyWay(t);
      env.setMilkyWay(t);
      return t;
    });
  loadText.textContent = 'Loading';
  await Promise.all([
    universe.preload((f) => {
      progress.tex = f;
      showProgress();
    }),
    sky.loadStars(`${BASE}data/stars.bin`).then(() => {
      progress.stars = 1;
      showProgress();
    }),
    shipView.load((f) => {
      progress.ship = f;
      showProgress();
    }).then((parts) => rig.setEye(parts.viewEye.clone())),
    loadSky(2048).then(() => {
      progress.sky = 1;
      showProgress();
    }),
  ]).catch((e: unknown) => {
    loadText.textContent = `Failed to load: ${String(e)}`;
    loadPct.textContent = '';
    throw e;
  });
  if (preset.milkyWay > 2048) void loadSky(preset.milkyWay);
  progress = { tex: 1, stars: 1, ship: 1, sky: 1 };
  showProgress();
  shipView.setScreens(mfd.textures);
  shipView.setEnvMap(env.texture);

  // --- UI
  let customLocations = loadCustomLocations();
  const fade = $('fade');
  const flashFade = () => {
    fade.classList.add('on');
    window.setTimeout(() => fade.classList.remove('on'), 60);
  };
  const goLocation = (l: SavedLocation) => {
    flashFade();
    warp.state = 'idle';
    warp.intensity = 0;
    ship.autopilot = false;
    if (l.epoch !== null) simMs = l.epoch;
    eph.update(simMs);
    l.place(eph, ship);
    ship.updateEnvironment();
    rig.resetLook();
    env.update(0, ship.absPos(new Vector3()), 1, true);
    hud.syncTouchThrottle(0);
    hud.toast(l.name);
  };
  const setFactor = (f: WarpFactor) => {
    if (warp.active) return;
    warp.factor = f;
    sound.play('click');
  };
  const engage = () => {
    sound.start();
    if (!warp.target) {
      hud.toast('Choose a destination on the map first (M)');
      sound.play('deny');
      return;
    }
    warp.engage();
  };
  const toggleMap = () => {
    if (map.open) {
      map.hide();
    } else {
      hud.closePanels();
      input.releaseLock();
      map.show();
    }
  };
  const applySettings = (s: Settings) => {
    input.sensitivity = 0.0022 * s.sensitivity;
    input.invertY = s.invertY;
    rig.fovBase = MathUtils.clamp(s.fov, 50, 110);
    sound.volume = s.volume;
    sound.setMuted(!s.sound);
    const next = PRESETS[s.quality];
    if (next !== preset) {
      const texChanged = next.maxTexture !== preset.maxTexture;
      preset = next;
      post.setAA(preset.aa, preset.sharpen);
      shipView.sun.shadow.mapSize.set(preset.shadow, preset.shadow);
      shipView.sun.shadow.map?.dispose();
      shipView.sun.shadow.map = null;
      shadowAge = Infinity;
      if (texChanged) universe.textures.maxWidth = Math.min(preset.maxTexture, renderer.capabilities.maxTextureSize);
      if (preset.milkyWay > 2048) void loadSky(preset.milkyWay);
      dynScale = 1;
      resize();
    }
  };

  /** Checks for a new version, lets a new service worker take over, then reloads. */
  let refreshing = false;
  const refreshApp = async () => {
    if (refreshing) return;
    refreshing = true;
    hud.toast('Checking for updates…', 8000);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.update();
        const next = reg.installing ?? reg.waiting;
        if (next) {
          hud.toast('Updating…', 8000);
          // the worker skips waiting by itself; wait until it controls the page (or give up after a while)
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
            next.addEventListener('statechange', () => next.state === 'activated' && done());
            next.postMessage({ type: 'SKIP_WAITING' });
            setTimeout(done, 10000);
          });
        }
      }
    } catch {
      /* offline or no service worker: a plain reload still helps */
    }
    location.reload();
  };

  const hud = new Hud(
    {
      toggleMap,
      cycleView: () => {
        const m = rig.cycle();
        shipView.configureShadows(m === 'cockpit');
        hud.toast(VIEW_NAMES[m], 1200);
      },
      setFactor,
      engage,
      abort: () => warp.abort(),
      timeFaster: () => {
        paused = false;
        timeIdx = Math.min(TIME_SCALES.length - 1, timeIdx + 1);
      },
      timeSlower: () => {
        paused = false;
        timeIdx = Math.max(0, timeIdx - 1);
      },
      timePause: () => (paused = !paused),
      timeNow: () => {
        simMs = Date.now();
        timeIdx = 0;
        paused = false;
        hud.toast('Back to real time');
      },
      goLocation,
      saveLocation: (name) => {
        saveCustomLocation(name, simMs, ship);
        customLocations = loadCustomLocations();
        hud.buildLocations(DEFAULT_LOCATIONS, customLocations);
        hud.toast(`Saved "${name}"`);
      },
      deleteLocation: (id) => {
        deleteCustomLocation(id);
        customLocations = loadCustomLocations();
        hud.buildLocations(DEFAULT_LOCATIONS, customLocations);
      },
      settingsChanged: applySettings,
      fullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      },
      clearTarget: () => warp.setTarget(null),
      refreshApp: () => void refreshApp(),
    },
    settings,
  );
  hud.buildLocations(DEFAULT_LOCATIONS, customLocations);
  const map = new SystemMap(eph, ship, warp);
  map.onClose = () => map.hide();
  map.onSelect = (t: WarpTarget) => {
    warp.setTarget(t);
    sound.play('click');
  };
  map.onFactor = (f) => setFactor(f);
  map.onWarp = (t, f) => {
    warp.setTarget(t);
    warp.factor = f;
    map.hide();
    engage();
  };
  const minimap = new Minimap(eph, ship, warp);
  minimap.onClick = toggleMap;
  hud.root.append(minimap.root);
  $('ui').append(hud.root, map.root);
  input.canLock = () => !map.open && !hud.panelOpen;
  input.onLockChange = (on) => hud.setMouseFlight(on);
  input.onLockError = () => hud.toast('The browser did not hand over the mouse. Right-click again.', 2400);
  applySettings(settings);

  warp.onEvent = (e) => {
    if (e === 'align') sound.play('confirm');
    else if (e === 'spool') sound.play('spool');
    else if (e === 'jump') sound.play('jump');
    else if (e === 'exit') sound.play('exit');
    else if (e === 'arrive') {
      sound.play('arrive');
      hud.toast(`Arrived · ${warp.targetName()}`);
    } else if (e === 'denied') {
      sound.play('deny');
      hud.toast(warp.message);
    } else if (e === 'abort') hud.toast('Warp aborted');
  };

  // --- sizing & dynamic resolution
  let dynScale = 1;
  let cssW = 1, cssH = 1;
  const resize = () => {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * dynScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(cssW, cssH, false);
    const w = Math.max(1, Math.round(cssW * pr));
    const h = Math.max(1, Math.round(cssH * pr));
    post.setSize(w, h);
    rig.camera.aspect = cssW / cssH;
    map.resize();
  };
  window.addEventListener('resize', resize);
  resize();

  const params = new URLSearchParams(location.search);
  // --- start state (deep links: ?loc=<id>&view=cockpit|chase|far)
  goLocation(DEFAULT_LOCATIONS.find((l) => l.id === params.get('loc')) ?? DEFAULT_LOCATIONS[0]);
  const startView = params.get('view');
  if (startView === 'chase' || startView === 'far' || startView === 'cockpit') rig.setMode(startView);
  hud.closePanels();
  // title screen: the scene plays behind it from a slow far-chase orbit; flight starts in `launchView`
  let intro = !params.has('autostart');
  const launchView = rig.mode;
  if (intro) {
    rig.setMode('far');
    rig.lookPitch = 0.08;
  }
  shipView.configureShadows(rig.mode === 'cockpit');

  const dbg = { canopy: true, bloom: 1, adapt: 1, cabin: 1, speed: 1 };
  // small console API (handy for sharing views and for automated tests)
  window.cosmos = {
    go: (id: string) => {
      const l = [...DEFAULT_LOCATIONS, ...customLocations].find((x) => x.id === id);
      if (l) goLocation(l);
    },
    view: (m: 'cockpit' | 'chase' | 'far') => {
      rig.setMode(m);
      shipView.configureShadows(m === 'cockpit');
    },
    look: (yaw: number, pitch: number) => {
      rig.lookYaw = yaw;
      rig.lookPitch = pitch;
    },
    warp: (id: string, factor: WarpFactor = 10) => {
      warp.setTarget({ kind: 'body', id });
      warp.factor = factor;
      engage();
    },
    time: (ms: number) => {
      simMs = ms;
    },
    debug: () => ({
      screens: shipView.parts?.screens.map((m) => `${m.name}:${(m.material as { type: string }).type}:${!!m.geometry.attributes.uv}`),
      tex: universe.views.map((v) => `${v.state.def.id}:${(v.mat.uniforms.uMap.value as { image?: { width: number } }).image?.width}`).join(' '),
    }),
    dbg: (o: Partial<typeof dbg>) => Object.assign(dbg, o),
    internals: () => ({ universe, sky, post, renderer, shipView, ship, warp, eph }),
    /** points the ship at a body */
    face: (id: string) => {
      const d = new Vector3().subVectors(eph.get(id).pos, ship.absPos(new Vector3())).normalize();
      lookQuat(d, new Vector3(0, 1, 0), ship.quat);
    },
    /** moves the ship next to a body (distance from its centre in km), sun behind */
    teleport: (id: string, km: number) => {
      const b = eph.get(id);
      const dir = new Vector3().subVectors(eph.get('sun').pos, b.pos).normalize();
      if (id === 'sun') dir.set(1, 0, 0);
      ship.frame = b;
      ship.setAbs(new Vector3().copy(b.pos).addScaledVector(dir, km));
      ship.vel.set(0, 0, 0);
      ship.throttle = 0;
      ship.updateEnvironment();
      lookQuat(dir.negate(), new Vector3(0, 1, 0), ship.quat);
    },
    probe: (id: string) => {
      const v = universe.byId.get(id)!;
      const rel = new Vector3().subVectors(v.state.pos, camAbs);
      project(rel, rel);
      const x = Math.round((rel.x * 0.5 + 0.5) * post.hdr.width), y = Math.round((rel.y * 0.5 + 0.5) * post.hdr.height);
      const buf = new Uint16Array(4 * 25);
      renderer.readRenderTargetPixels(post.hdr, x - 2, y - 2, 5, 5, buf);
      const f = Array.from(buf).map((h) => {
        const e = (h >> 10) & 31, m = h & 1023, sg = h >> 15 ? -1 : 1;
        return e === 0 ? sg * m * 2 ** -24 : e === 31 ? NaN : sg * (1 + m / 1024) * 2 ** (e - 15);
      });
      const pts = (universe as unknown as { pointInt: Float32Array }).pointInt;
      return { x, y, ndc: [rel.x, rel.y, rel.z], max: Math.max(...f.filter((_, i) => i % 4 !== 3)), int: pts[universe.views.indexOf(v)] };
    },
    state: () => ({
      simMs, frame: ship.frame.def.id, altitude: ship.altitude, warp: warp.state, dynScale,
      fps: Math.round(1 / Math.max(fpsAvg, 1e-3)),
    }),
  };

  // Look for a new version whenever the app comes back to the foreground, and every 30 minutes.
  // When one takes over while the game is open, light up the update button rather than reload mid-flight.
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    const checkForUpdate = () => {
      navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkForUpdate());
    window.setInterval(checkForUpdate, 30 * 60 * 1000);
    // the build this page runs, to tell a newer deploy from the worker of the one already loaded
    const ownScript = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing || !ownScript) return;
      fetch('/index.html', { cache: 'no-store' })
        .then((r) => r.text())
        .then((html) => !html.includes(ownScript) && hud.setUpdateReady())
        .catch(() => undefined);
    });
  }
  window.addEventListener('pointerdown', () => sound.start(), { once: true });

  // --- frame loop
  const camAbs = new Vector3();
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const fwd = new Vector3();
  const sunUv = new Vector2();
  const apex = new Vector2(0.5, 0.5);
  const viewport = new Vector2();
  const camQ = new Quaternion();
  let last = performance.now();
  let t = 0;
  let frameAcc = 0, frameN = 0, lastScaleChange = 0;
  let fpsAvg = 1 / 60;
  let fpsTime = 0, fpsFrames = 0;
  let engThr = 0;
  let warpSeed = Math.random();
  // The ship's shadow map is redrawn only when the light moves across the ship (it turns, or the
  // view changes), and every few frames for the pilot's small movements: it was a sizeable part of the GPU frame.
  renderer.shadowMap.autoUpdate = false;
  const shadowSunDir = new Vector3();
  const shipQInv = new Quaternion();
  const sunInShip = new Vector3();
  let shadowAge = Infinity;
  let shadowMode = '';
  let prevWarpState = 'idle';

  const project = (rel: Vector3, out: Vector3) => out.copy(rel).applyMatrix4(universe.camera.matrixWorldInverse).applyMatrix4(universe.camera.projectionMatrix);

  const handleKeys = () => {
    for (const code of input.consumePressed()) {
      if (code === 'Escape') {
        if (map.open) map.hide();
        else hud.closePanels();
        continue;
      }
      if (code === 'KeyM') toggleMap();
      if (map.open) continue;
      switch (code) {
        case 'KeyV':
        case 'KeyC': {
          const m = rig.cycle();
          shipView.configureShadows(m === 'cockpit');
          hud.toast(VIEW_NAMES[m], 1200);
          break;
        }
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
          setFactor(WARP_FACTORS[Number(code.slice(5)) - 1]);
          break;
        case 'KeyJ':
          if (warp.active) warp.abort();
          else engage();
          break;
        case 'KeyL':
          hud.showPanel(hud.locPanel);
          break;
        case 'KeyH':
          hud.showPanel(hud.helpPanel);
          break;
        case 'KeyT':
          settings.labels = !settings.labels;
          hud.refreshToggles();
          saveSettings(settings);
          break;
        case 'KeyG':
          hud.toggle('fps');
          break;
        case 'KeyN':
          hud.toggle('minimap');
          break;
        case 'KeyF':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => undefined);
          break;
        case 'Comma':
          timeIdx = Math.max(0, timeIdx - 1);
          break;
        case 'Period':
          timeIdx = Math.min(TIME_SCALES.length - 1, timeIdx + 1);
          break;
        case 'KeyP':
          paused = !paused;
          break;
        case 'KeyR':
          rig.resetLook();
          break;
      }
    }
  };

  const frame = () => {
    requestAnimationFrame(frame);
    const now = performance.now();
    prof.beginFrame();
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.1) * dbg.speed;
    t += dt;

    // dynamic resolution (keeps the frame rate smooth on weaker GPUs)
    frameAcc += rawDt;
    frameN++;
    fpsAvg += (rawDt - fpsAvg) * 0.05;
    // on-screen counter: real frames per second over half-second windows
    fpsTime += rawDt;
    fpsFrames++;
    if (fpsTime >= 0.5) {
      hud.setFps(fpsFrames / fpsTime, (fpsTime / fpsFrames) * 1000, dynScale, prof.enabled ? {
        report: prof.report(),
        quality: settings.quality,
        width: post.hdr.width,
        height: post.hdr.height,
        gpu: prof.gpuName,
      } : null);
      prof.enabled = settings.fps && settings.perf;
      fpsTime = 0;
      fpsFrames = 0;
    }
    if (frameAcc > 2) {
      const avg = frameAcc / frameN;
      frameAcc = 0;
      frameN = 0;
      if (t - lastScaleChange > 3 && !params.has('nodyn')) {
        if (avg > 1 / 42 && dynScale > 0.55) {
          dynScale = Math.max(0.55, dynScale - 0.15);
          lastScaleChange = t;
          resize();
        } else if (avg < 1 / 57 && dynScale < 1) {
          dynScale = Math.min(1, dynScale + 0.15);
          lastScaleChange = t;
          resize();
        }
      }
    }

    if (intro) {
      // nothing flies the ship on the title screen; the camera drifts around it
      input.consumePressed();
      input.consumeLook();
      rig.lookYaw += dt * 0.04;
    } else handleKeys();
    const timeScale = paused ? 0 : TIME_SCALES[timeIdx];
    simMs += dt * 1000 * timeScale;
    eph.update(simMs);

    // flight
    const fi = input.flight();
    const blocked = intro || map.open || hud.panelOpen;
    if (blocked) {
      fi.pitch = fi.yaw = fi.roll = fi.throttleDelta = fi.mousePitch = fi.mouseYaw = 0;
      fi.boost = fi.brake = false;
    }
    fi.pitch += hud.stick.y * (settings.invertY ? -1 : 1) * 0.9;
    fi.yaw -= hud.stick.x * 0.9;
    fi.roll += hud.touchRoll;
    if (hud.touchThrottle !== null) {
      ship.throttle = hud.touchThrottle;
      hud.touchThrottle = null;
    }
    ship.update(dt, fi);
    if (fi.throttleDelta !== 0 || fi.brake) hud.syncTouchThrottle(ship.throttle);
    warp.update(dt);
    prof.cpu('Flight & orbits');

    // camera
    const look = map.open ? ([0, 0] as [number, number]) : input.consumeLook();
    rig.update(dt, ship.quat, look, input.dragging, warp.intensity, warp.shake, t);
    ship.absPos(camAbs).addScaledVector(rig.offset, 0.001);
    camQ.copy(rig.quat);

    const bufH = post.hdr.height;
    const bufW = post.hdr.width;
    const pr = bufH / cssH;
    universe.setViewport(bufH, rig.camera.fov, cssW / cssH);

    // exposure: compensate partially for the inverse-square falloff of sunlight in the outer system
    const sun = eph.get('sun');
    const dSunAU = Math.max(camAbs.distanceTo(sun.pos) / AU_KM, 0.05);
    const distExposure = Math.pow(Math.max(dSunAU, 0.3), 1.55);
    // dim stars while a big sunlit body fills the view (the eye adapts to it)
    let litCover = 0;
    for (const v of universe.views) {
      if (v.state.def.kind === 'star' || !v.mesh.visible) continue;
      const area = Math.min(1, (Math.PI * v.pixelRadius * v.pixelRadius) / (bufW * bufH));
      if (area < 0.002) continue;
      tmp.subVectors(sun.pos, v.state.pos).normalize();
      tmp2.subVectors(camAbs, v.state.pos).normalize();
      const phase = (1 + tmp.dot(tmp2)) / 2;
      litCover += area * phase * Math.min(1, v.state.def.albedo * 3 + 0.2) / (dSunAU * dSunAU) * distExposure;
    }
    const skyBright = (1 / distExposure) / (1 + Math.min(litCover, 1) * 22);
    universe.pointBrightness = 1 / distExposure;
    universe.update(camAbs, camQ, t, (simMs - Date.UTC(2000, 0, 1, 12)) / DAY_MS, pr);
    prof.cpu('Planets & map streaming');

    // warp / sky
    ship.forward(fwd);
    const fNorm = Math.log(warp.factor) / Math.log(100);
    const beta = warp.visualBeta + warp.spool * 0.12;
    sky.update(camQ, universe.camera.projectionMatrix, viewport.set(bufW, bufH), pr, skyBright, fwd, beta, warp.intensity);

    // ship lighting
    const shipAbs = ship.absPos(tmp2);
    const toSun = tmp.subVectors(sun.pos, shipAbs);
    const dSun = toSun.length();
    toSun.multiplyScalar(1 / dSun);
    const vis = sunVisibility(eph, shipAbs);
    const irr = (AU_KM / dSun) ** 2;
    const sl = shipView.sun;
    const focus = rig.mode === 'cockpit' ? rig.offset : ORIGIN;
    sl.target.position.copy(focus);
    sl.position.copy(focus).addScaledVector(toSun, rig.mode === 'cockpit' ? 8 : 45);
    sl.intensity = irr * Math.PI * vis;
    sl.color.setRGB(SUN_COLOR.x, SUN_COLOR.y, SUN_COLOR.z);
    sl.castShadow = vis > 0.01;
    sunInShip.copy(toSun).applyQuaternion(shipQInv.copy(ship.quat).invert());
    shadowAge++;
    if (sl.castShadow && (shadowAge >= 4 || rig.mode !== shadowMode || sunInShip.dot(shadowSunDir) < 0.9999998)) {
      renderer.shadowMap.needsUpdate = true;
      shadowSunDir.copy(sunInShip);
      shadowMode = rig.mode;
      shadowAge = 0;
    }
    prof.gpu('Reflections');
    env.update(dt, camAbs, 1 / distExposure);
    prof.gpuEnd();

    const parts = shipView.parts!;
    parts.root.quaternion.copy(ship.quat);
    const thr = warp.active ? Math.max(0.15, warp.spool) : ship.throttle * (fi.boost ? 1.4 : 1);
    engThr = MathUtils.lerp(engThr, Math.min(1.3, thr * 0.9 + 0.02), 1 - Math.exp(-dt * 6));
    shipView.setEngines(engThr, Math.max(warp.spool, warp.intensity), t);
    const eg = 1 / distExposure;
    shipView.setEmissiveGain(eg);
    parts.nav.mat.uniforms.uPx.value = pr;
    parts.nav.mat.uniforms.uTime.value = t;
    const cockpit = rig.mode === 'cockpit';
    shipView.cabin.intensity = (cockpit ? 0.35 : 0.15) * eg * dbg.cabin;
    if (parts.canopy) parts.canopy.visible = dbg.canopy;
    shipView.setCanopyOutside(!cockpit);
    // the pilot's stick follows the turn rates, the lever the throttle
    _rates.set(ship.angVel.x / 1.1, ship.angVel.y / 1.1, ship.angVel.z / 1.54).clampScalar(-1, 1);
    parts.pilot.update(dt, _rates, ship.throttle, t, cockpit);
    shipView.screenLight.intensity = 0.3 * eg;
    // warp light: calm and blue at 1c, flickering and drifting through colours at 100c
    if (warp.state !== 'idle' && prevWarpState === 'idle') warpSeed = Math.random();
    prevWarpState = warp.state;
    const flick = 1 + fNorm * (0.5 * Math.sin(t * 7.3 + warpSeed * 20) * Math.sin(t * 3.1 + warpSeed * 9) + 2.5 * Math.max(0, Math.sin(t * 17 + warpSeed * 40)) ** 12);
    shipView.warpLight.color.setHSL(0.6 + fNorm * 0.22 * Math.sin(t * 0.9 + warpSeed * 30), 0.55 + 0.35 * fNorm, 0.7);
    shipView.warpLight.intensity = (warp.intensity * 8 + warp.spool * 6 + warp.flash * 20) * flick * (cockpit ? 0.8 : 1) * eg;
    prof.cpu('Ship & lighting');
    mfd.update(dt, simMs);
    prof.cpu('Cockpit screens');

    // render
    prof.gpu('Sky & stars');
    renderer.setRenderTarget(post.hdr);
    renderer.clear(true, true, false);
    renderer.render(sky.scene, sky.camera);
    prof.gpu('Planets & moons');
    renderer.render(universe.scene, universe.camera);
    prof.gpu('Ship');
    renderer.clearDepth();
    // alpha becomes a ship mask (0 = world, 1 = ship) so warp distortion only bends space outside the hull
    gl.colorMask(false, false, false, true);
    renderer.setClearColor(BLACK, 0);
    renderer.clear(true, false, false);
    gl.colorMask(true, true, true, true);
    renderer.setClearColor(BLACK, 1);
    renderer.render(shipView.scene, rig.camera);

    // sun flare
    tmp.subVectors(sun.pos, camAbs);
    const sunDist = tmp.length();
    project(tmp, tmp);
    const inFront = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 0.98 && Math.abs(tmp.y) < 0.98;
    sunUv.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);
    // warp apex
    tmp.copy(fwd).multiplyScalar(1e6);
    project(tmp, tmp);
    if (tmp.z < 1) apex.set(MathUtils.clamp(tmp.x * 0.5 + 0.5, -0.5, 1.5), MathUtils.clamp(tmp.y * 0.5 + 0.5, -0.5, 1.5));

    const warpVis = warp.intensity * (0.55 + 0.45 * fNorm);
    post.render({
      exposure: 1.15 * distExposure,
      adaptStrength: 0.45 * dbg.adapt * (1 - 0.6 * warp.intensity),
      bloomStrength: (0.045 + warpVis * 0.02) * dbg.bloom,
      time: t,
      dt,
      sunUv,
      sunOn: inFront ? 1 : 0,
      sunPower: MathUtils.clamp(Math.pow(AU_KM / sunDist, 0.8), 0.12, 1.6),
      apex,
      warp: warpVis,
      warpSpeed: 1.2 + fNorm * 2.5,
      flash: warp.flash,
      bubble: Math.max(warp.spool * 0.55, warp.intensity * (0.6 + 0.4 * fNorm)),
      shake: Math.max(warp.shake, warp.intensity * fNorm * 0.18),
      spool: warp.spool,
      rays: Math.max(warp.spool * 0.7, warpVis),
      chaos: fNorm,
      seed: warpSeed,
    });
    prof.gpuEnd();
    prof.cpu('Render calls');

    // HUD
    sound.update(ship.throttle, fi.boost, warp.spool, warp.intensity, cockpit);
    const target = warp.target;
    const tp = target ? warp.resolve(tmp2) : null;
    const tDist = tp ? tp.distanceTo(ship.absPos(tmp)) : 0;
    hud.update({
      speed: ship.speed,
      limit: ship.limit,
      throttle: ship.throttle,
      ...placeInfo(),
      frame: ship.frame.def.name,
      simMs,
      timeScale,
      warpState: warp.state,
      warpFactor: warp.factor,
      warpSpool: warp.spool,
      warpSpeed: warp.speed,
      warpDistance: warp.distance,
      targetName: target ? warp.targetName() : '',
      targetDistance: tDist,
      targetEta: tDist / (warp.factor * C_KMS),
      view: VIEW_NAMES[rig.mode],
      boost: fi.boost,
    });
    updateMarkers(tp);
    hud.setReticle(!cockpit && !map.open);
    if (input.pointerLocked && (map.open || hud.panelOpen)) input.releaseLock();
    if (input.pointerLocked && !map.open) {
      const focal = (cssH / 2) / Math.tan(MathUtils.degToRad(rig.camera.fov) / 2);
      hud.setAim({ x: -Math.tan(ship.aim.x) * focal, y: -Math.tan(ship.aim.y) * focal });
    } else hud.setAim(null);
    prof.cpu('HUD & labels');
    if (map.open) map.draw(simMs, t);
    else if (settings.minimap) minimap.update(dt, t);
    prof.cpu('Map & minimap');
    prof.endFrame();
  };

  const placeInfo = () => {
    const near = ship.nearest;
    if (ship.altitude < near.def.radius * 12) return { altitude: ship.altitude, nearest: near.def.name };
    const f = ship.frame;
    const alt = ship.rel.length() - f.def.radius;
    if (f.def.kind === 'star') return { altitude: alt, nearest: 'Interplanetary space' };
    return { altitude: alt, nearest: `${f.def.name} system` };
  };
  const cssPerRad = () => cssH / (2 * Math.tan((rig.camera.fov * Math.PI) / 360));
  const mk = new Vector3();
  const updateMarkers = (tp: Vector3 | null) => {
    // target bracket
    if (tp && warp.state !== 'cruise') {
      mk.subVectors(tp, camAbs);
      const dist = mk.length();
      let r = 0;
      if (warp.target?.kind === 'body') {
        const v = universe.byId.get(warp.target.id)!;
        mk.subVectors(v.state.pos, camAbs);
        r = (Math.asin(Math.min(1, v.state.def.radius / Math.max(mk.length(), 1))) * cssPerRad());
      }
      const cam = mk.clone().applyQuaternion(camQ.clone().invert());
      project(mk, mk);
      const label = `${warp.targetName()} · ${fmtDistance(dist)}`;
      if (cam.z < 0 && Math.abs(mk.x) <= 1 && Math.abs(mk.y) <= 1) {
        hud.setMarker({ x: (mk.x * 0.5 + 0.5) * cssW, y: (0.5 - mk.y * 0.5) * cssH, r }, null, label);
      } else {
        // off-screen arrow along the projected direction
        const ang = Math.atan2(-cam.y, cam.x);
        const ex = cssW / 2 + Math.cos(ang) * (cssW / 2 - 40);
        const ey = cssH / 2 + Math.sin(ang) * (cssH / 2 - 40);
        hud.setMarker(null, { x: ex, y: ey, ang }, label);
      }
    } else hud.setMarker(null, null, '');

    // body labels
    if (!settings.labels || map.open || warp.state === 'cruise') {
      hud.setLabels([]);
      return;
    }
    const items: { x: number; y: number; text: string; sub: string }[] = [];
    const placed: [number, number][] = [];
    const sys = ship.frame.def.kind === 'moon' && ship.frame.parent ? ship.frame.parent : ship.frame;
    const sorted = [...universe.views].sort((a, b) => a.distance - b.distance);
    for (const v of sorted) {
      const d = v.state.def;
      const isMoon = d.kind === 'moon';
      if (isMoon && v.state.parent !== sys && v.state !== ship.frame) continue;
      const inSystem = v.state === sys || v.state.parent === sys;
      if (!inSystem && d.kind !== 'star' && v.pixelRadius < 1 && v.apparentMag > 5.5) continue;
      if (v.pixelRadius * (cssH / post.hdr.height) > cssH * 0.35) continue;
      if (warp.target?.kind === 'body' && warp.target.id === d.id) continue;
      mk.subVectors(v.state.pos, camAbs);
      const cz = mk.clone().applyQuaternion(camQ.clone().invert()).z;
      if (cz >= 0) continue;
      if (universe.rayBlocked(tmp.copy(mk).normalize(), v.distance - d.radius, d.id) < v.distance - d.radius) continue;
      project(mk, mk);
      if (Math.abs(mk.x) > 1 || Math.abs(mk.y) > 1) continue;
      const x = (mk.x * 0.5 + 0.5) * cssW;
      const rCss = v.pixelRadius * (cssH / post.hdr.height);
      const y = (0.5 - mk.y * 0.5) * cssH - rCss;
      if (placed.some(([px, py]) => Math.abs(px - x) < 90 && Math.abs(py - y) < 26)) continue;
      placed.push([x, y]);
      items.push({ x, y, text: d.name, sub: fmtDistance(v.distance) });
      if (items.length >= 18) break;
    }
    hud.setLabels(items);
  };

  requestAnimationFrame(frame);

  // --- title screen, shown over the running scene once its first frames are drawn
  if (intro) {
    await new Promise<void>((resolve) => {
      let n = 0;
      const tick = () => (++n > 3 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    loading.classList.add('ready');
    window.setTimeout(() => document.getElementById('load-stars')?.remove(), 2000);
    const start = $<HTMLButtonElement>('start');
    await new Promise<void>((resolve) => {
      const go = () => {
        window.removeEventListener('keydown', onKey);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
          e.preventDefault();
          go();
        }
      };
      start.addEventListener('click', go, { once: true });
      window.addEventListener('keydown', onKey);
    });
    // on phones and tablets, go full screen and hold landscape (where the browser allows it)
    if (matchMedia('(pointer: coarse)').matches) {
      try {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
      } catch {
        /* not supported (iOS Safari) or refused: the rotate prompt covers it */
      }
    }
  }
  document.body.classList.add('playing');
  sound.start();
  sound.setMuted(!settings.sound);
  if (intro) {
    // dip to black, cut to the flight view, then fade back in with the HUD
    loading.classList.add('done');
    fade.classList.add('dip');
    await new Promise((r) => window.setTimeout(r, 550));
    intro = false;
    rig.setMode(launchView);
    shipView.configureShadows(launchView === 'cockpit');
    fade.classList.remove('dip');
  }
  document.body.classList.remove('intro');
  loading.classList.add('done');
  window.setTimeout(() => loading.remove(), 1200);
  hud.toast(
    matchMedia('(pointer: coarse)').matches
      ? 'Welcome aboard. Left thumb steers, right thumb sets the throttle.'
      : 'Welcome aboard. Press H for controls, M for the map.',
    5000,
  );
}

void main();
