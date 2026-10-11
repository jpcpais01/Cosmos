import type { WebGLRenderer } from 'three';

/** Averaged costs over the last report window, in milliseconds per frame. */
export interface ProfileReport {
  /** GPU time of each render pass, in frame order (empty when the browser has no GPU timers) */
  gpu: [string, number][];
  gpuTotal: number;
  /** main-thread JavaScript time of each part of the frame, in frame order */
  cpu: [string, number][];
  cpuTotal: number;
  gpuTimers: boolean;
  calls: number;
  triangles: number;
}

interface Pending {
  q: WebGLQuery;
  name: string;
  /** first pass of its frame (used to count frames whose GPU times have arrived) */
  first: boolean;
}

/**
 * Per-pass GPU timers (EXT_disjoint_timer_query_webgl2) and main-thread section timers.
 * GPU results arrive a few frames late, so everything is summed over a window and averaged
 * per frame when read. Costs nothing while disabled.
 */
export class FrameProfiler {
  enabled = false;
  private gl: WebGL2RenderingContext;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pool: WebGLQuery[] = [];
  private pending: Pending[] = [];
  private active: Pending | null = null;
  private gpuAcc = new Map<string, number>();
  private cpuAcc = new Map<string, number>();
  private frames = 0;
  private gpuFrames = 0;
  private lastMark = 0;
  private newFrame = false;
  private calls = 0;
  private triangles = 0;
  /** GPU model as reported by the browser */
  readonly gpuName: string;

  constructor(private renderer: WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const dbg = this.gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(this.gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : this.gl.RENDERER) ?? '');
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> what is inside
    this.gpuName = name.replace(/^ANGLE \((.*)\)$/, '$1').trim();
    // three.js draws shadow maps inside render(); time them as their own pass, then resume the one around it
    const sm = renderer.shadowMap;
    const render = sm.render;
    sm.render = (lights, scene, camera) => {
      const outer = this.active?.name;
      if (!this.enabled || !lights.length || !outer) {
        render.call(sm, lights, scene, camera);
        return;
      }
      this.gpu('Ship shadows');
      render.call(sm, lights, scene, camera);
      this.gpu(outer);
    };
  }

  get gpuTimers(): boolean {
    return this.ext !== null;
  }

  /** Call at the very start of a frame. */
  beginFrame(): void {
    if (!this.enabled) return;
    this.frames++;
    this.lastMark = performance.now();
    this.newFrame = true;
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.collect();
  }

  /** Main-thread time since the previous mark (or the frame start) is charged to `name`. */
  cpu(name: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.cpuAcc.set(name, (this.cpuAcc.get(name) ?? 0) + now - this.lastMark);
    this.lastMark = now;
  }

  /** Starts timing GPU work under `name` (ends the previous pass). */
  gpu(name: string): void {
    if (!this.enabled || !this.ext) return;
    this.gpuEnd();
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = { q, name, first: this.newFrame };
    this.newFrame = false;
  }

  gpuEnd(): void {
    if (!this.active || !this.ext) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Call at the end of a frame. */
  endFrame(): void {
    if (!this.enabled) return;
    this.gpuEnd();
    this.calls += this.renderer.info.render.calls;
    this.triangles += this.renderer.info.render.triangles;
  }

  private collect(): void {
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl;
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      // timings this window are garbage (power state change, context switch): drop them
      for (const p of this.pending) this.pool.push(p.q);
      this.pending.length = 0;
      return;
    }
    let done = 0;
    for (const p of this.pending) {
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      this.gpuAcc.set(p.name, (this.gpuAcc.get(p.name) ?? 0) + ns / 1e6);
      if (p.first) this.gpuFrames++;
      this.pool.push(p.q);
      done++;
    }
    if (done) this.pending.splice(0, done);
  }

  /** Averages since the previous report, then starts a new window. */
  report(): ProfileReport {
    const f = Math.max(1, this.frames);
    const gf = Math.max(1, this.gpuFrames);
    const gpu = [...this.gpuAcc].map(([k, v]) => [k, v / gf] as [string, number]);
    const cpu = [...this.cpuAcc].map(([k, v]) => [k, v / f] as [string, number]);
    const r: ProfileReport = {
      gpu,
      gpuTotal: gpu.reduce((s, [, v]) => s + v, 0),
      cpu,
      cpuTotal: cpu.reduce((s, [, v]) => s + v, 0),
      gpuTimers: !!this.ext,
      calls: this.calls / f,
      triangles: this.triangles / f,
    };
    // keep the keys (and so the row order) but zero the sums
    for (const k of this.gpuAcc.keys()) this.gpuAcc.set(k, 0);
    for (const k of this.cpuAcc.keys()) this.cpuAcc.set(k, 0);
    this.frames = this.gpuFrames = this.calls = this.triangles = 0;
    return r;
  }
}
