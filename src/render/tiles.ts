import {
  ClampToEdgeWrapping, DataTexture, ImageBitmapLoader, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat,
  SRGBColorSpace, UnsignedByteType, Vector4, type WebGLRenderer,
} from 'three';

/** Tile edge in texels; the build step cuts every large tier into tiles of this size. */
export const TILE = 512;
/** The window is WIN x WIN tiles (2048 x 2048 texels). */
const WIN = 4;
const BASE = import.meta.env.BASE_URL;

interface Layout {
  level: number; // full-globe width the tiles belong to
  x0: number; // first column (wraps around)
  y0: number; // first row from the south
  nx: number;
  ny: number;
  wx: number;
  wy: number;
}

/** Decoded tiles shared by every window, least recently used dropped first. */
export class TileCache {
  private bitmaps = new Map<string, ImageBitmap>();
  private loading = new Map<string, Promise<ImageBitmap | null>>();
  private loader = new ImageBitmapLoader();
  private inflight = 0;
  private queue: (() => void)[] = [];

  constructor(private capacity = 48) {
    this.loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  }

  peek(url: string): ImageBitmap | undefined {
    const b = this.bitmaps.get(url);
    if (b) {
      // refresh LRU order
      this.bitmaps.delete(url);
      this.bitmaps.set(url, b);
    }
    return b;
  }

  fetch(url: string): Promise<ImageBitmap | null> {
    const have = this.peek(url);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(url);
    if (p) return p;
    p = new Promise<ImageBitmap | null>((resolve) => {
      const run = () => {
        this.inflight++;
        this.loader.load(
          url,
          (bmp) => {
            this.done(url);
            const b = bmp as unknown as ImageBitmap;
            this.bitmaps.set(url, b);
            this.trim();
            resolve(b);
          },
          undefined,
          () => {
            this.done(url);
            resolve(null);
          },
        );
      };
      if (this.inflight < 6) run();
      else this.queue.push(run);
    });
    this.loading.set(url, p);
    return p;
  }

  private done(url: string): void {
    this.inflight--;
    this.loading.delete(url);
    while (this.queue.length && this.inflight < 6) this.queue.shift()!();
  }

  private trim(): void {
    while (this.bitmaps.size > this.capacity) {
      const [k, b] = this.bitmaps.entries().next().value as [string, ImageBitmap];
      b.close();
      this.bitmaps.delete(k);
    }
  }
}

/**
 * A 2048 x 2048 texture holding the 4 x 4 tiles around the point of a planet you are looking at,
 * at the resolution your distance calls for. The shader samples it inside `rect` (equirectangular
 * uv: x0, y0, width, height) and falls back to the small whole-globe map elsewhere.
 * A new layout is filled in a second texture and swapped in once complete, so it never shows a mix.
 */
export class TileWindow {
  /** texture the shader samples (null until the first layout is complete) */
  texture: DataTexture | null = null;
  readonly rect = new Vector4(0, 0, 1, 1);
  private front?: Layout;
  private back?: { layout: Layout; tex: DataTexture; filled: Set<string>; serial: number; failed: boolean };
  private serial = 0;
  private retryAt = 0;
  lastUsed = 0;

  constructor(
    private renderer: WebGLRenderer,
    private cache: TileCache,
    private body: string,
    private kind: string,
    private srgb: boolean,
  ) {}

  get active(): boolean {
    return this.texture !== null;
  }

  /** Points the window at (u, v) on the globe at the given full-globe width. */
  update(u: number, v: number, level: number, now: number): void {
    this.lastUsed = now;
    const nx = level / TILE;
    const ny = level / 2 / TILE;
    const wx = Math.min(WIN, nx);
    const wy = Math.min(WIN, ny);
    const cx = u * nx;
    const cy = v * ny;
    const cur = this.back?.layout ?? this.front;
    if (cur && cur.level === level) {
      // keep the current layout while the view point stays near its middle
      const mx = cur.x0 + cur.wx / 2;
      let dx = cx - mx;
      dx -= Math.round(dx / nx) * nx;
      const my = cur.y0 + cur.wy / 2;
      const slackX = cur.wx >= nx ? Infinity : cur.wx / 2 - 1.25;
      const slackY = cur.wy >= ny ? Infinity : cur.wy / 2 - 1.25;
      const atEdge = (cur.y0 === 0 && cy < my) || (cur.y0 + cur.wy === ny && cy > my);
      if (Math.abs(dx) <= slackX && (Math.abs(cy - my) <= slackY || atEdge)) return;
    }
    if (now < this.retryAt) return; // a tile failed to load (offline?); keep what we have for a while
    const layout: Layout = {
      level, nx, ny, wx, wy,
      x0: (((Math.round(cx - wx / 2)) % nx) + nx) % nx,
      y0: Math.min(ny - wy, Math.max(0, Math.round(cy - wy / 2))),
    };
    this.begin(layout);
  }

  private begin(layout: Layout): void {
    if (this.back) this.back.tex.dispose();
    const tex = new DataTexture(null, layout.wx * TILE, layout.wy * TILE, RGBAFormat, UnsignedByteType);
    tex.source.dataReady = false; // allocate storage only; tiles are uploaded one by one
    tex.colorSpace = this.srgb ? SRGBColorSpace : NoColorSpace;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.flipY = false;
    tex.needsUpdate = true;
    this.renderer.initTexture(tex);
    const serial = ++this.serial;
    this.back = { layout, tex, filled: new Set(), serial, failed: false };
    for (let j = 0; j < layout.wy; j++) {
      for (let i = 0; i < layout.wx; i++) {
        const x = (layout.x0 + i) % layout.nx;
        const y = layout.y0 + j;
        const url = `${BASE}textures/${this.body}/${this.kind}_${layout.level}/${x}_${y}.webp`;
        const put = (bmp: ImageBitmap | null) => {
          const b = this.back;
          if (!b || b.serial !== serial) return; // superseded by a newer layout
          if (bmp) this.upload(b.tex, bmp, i * TILE, j * TILE);
          else b.failed = true;
          b.filled.add(url);
          if (b.filled.size < layout.wx * layout.wy) return;
          if (!b.failed) this.swap();
          else {
            // never show a window with holes in it
            b.tex.dispose();
            this.back = undefined;
            this.retryAt = performance.now() + 10000;
          }
        };
        const have = this.cache.peek(url);
        if (have) put(have);
        else void this.cache.fetch(url).then(put);
      }
    }
  }

  private upload(tex: DataTexture, bmp: ImageBitmap, x: number, y: number): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;
    const glTex = (this.renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!glTex) return;
    state.activeTexture(gl.TEXTURE0);
    state.bindTexture(gl.TEXTURE_2D, glTex);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  }

  private swap(): void {
    const b = this.back!;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const glTex = (this.renderer.properties.get(b.tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (glTex) {
      this.renderer.state.activeTexture(gl.TEXTURE0);
      this.renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    this.texture?.dispose();
    this.texture = b.tex;
    this.front = b.layout;
    const l = b.layout;
    this.rect.set(l.x0 / l.nx, l.y0 / l.ny, l.wx / l.nx, l.wy / l.ny);
    this.back = undefined;
  }

  /** Stops using the window (far from the planet); its memory is released. */
  release(): void {
    this.back?.tex.dispose();
    this.back = undefined;
    this.texture?.dispose();
    this.texture = null;
    this.front = undefined;
    this.serial++;
  }
}
