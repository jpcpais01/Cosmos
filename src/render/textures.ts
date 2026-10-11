import {
  ClampToEdgeWrapping, DataTexture, ImageBitmapLoader, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping,
  RGBAFormat, SRGBColorSpace, Texture, UnsignedByteType, type WebGLRenderer,
} from 'three';
import manifest from '../data/textures.json';

type Kind = 'map' | 'normal' | 'aux';
const MANIFEST = manifest as Record<string, Partial<Record<Kind, number[]>>>;

interface Entry {
  tex?: Texture;
  loading?: Promise<Texture>;
  lastUsed: number;
  width: number;
}

const BASE = import.meta.env.BASE_URL;

/** Streams equirectangular texture tiers: low tier always resident, higher tiers on demand. */
export class TextureStreamer {
  private cache = new Map<string, Entry>();
  private loader = new ImageBitmapLoader();
  private inflight = 0;
  private queue: (() => void)[] = [];
  maxWidth: number;
  private anisotropy: number;
  onLoaded?: () => void;

  constructor(private renderer: WebGLRenderer, maxWidth: number) {
    this.maxWidth = Math.min(maxWidth, renderer.capabilities.maxTextureSize);
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  }

  sizes(body: string, kind: Kind): number[] {
    return (MANIFEST[body]?.[kind] ?? []).filter((w) => w <= this.maxWidth);
  }

  has(body: string, kind: Kind): boolean {
    return this.sizes(body, kind).length > 0;
  }

  /** Loads the smallest tier; resolves when ready. */
  async preload(body: string, kind: Kind): Promise<Texture | null> {
    const s = this.sizes(body, kind);
    if (!s.length) return null;
    return this.load(body, kind, s[0]);
  }

  /**
   * Returns the best texture already resident at or below the wanted width, and
   * starts loading the right tier if it is not resident yet.
   */
  get(body: string, kind: Kind, wantWidth: number, now: number): Texture | null {
    const s = this.sizes(body, kind);
    if (!s.length) return null;
    let target = s[0];
    for (const w of s) if (w <= wantWidth * 1.25 || w === s[0]) target = w;
    // hysteresis: keep a higher resident tier while still roughly needed
    let best: Entry | undefined;
    for (const w of s) {
      const e = this.cache.get(`${body}/${kind}_${w}`);
      if (e?.tex && w <= Math.max(target, wantWidth * 2.5)) best = e;
    }
    const te = this.cache.get(`${body}/${kind}_${target}`);
    if (!te?.tex && !te?.loading) void this.load(body, kind, target);
    if (best) best.lastUsed = now;
    if (te) te.lastUsed = now;
    return best?.tex ?? null;
  }

  private load(body: string, kind: Kind, w: number): Promise<Texture> {
    const key = `${body}/${kind}_${w}`;
    let e = this.cache.get(key);
    if (e?.tex) return Promise.resolve(e.tex);
    if (e?.loading) return e.loading;
    e = { lastUsed: performance.now(), width: w };
    this.cache.set(key, e);
    const url = `${BASE}textures/${body}/${kind}_${w}.webp`;
    const entry = e;
    entry.loading = new Promise<Texture>((resolve, reject) => {
      const run = () => {
        this.inflight++;
        this.loader.load(
          url,
          (bmp) => {
            this.inflight--;
            this.next();
            const tex = new Texture(bmp as unknown as HTMLImageElement);
            tex.flipY = false;
            tex.colorSpace = kind === 'map' ? SRGBColorSpace : NoColorSpace;
            tex.wrapS = RepeatWrapping;
            tex.wrapT = ClampToEdgeWrapping;
            tex.minFilter = LinearMipmapLinearFilter;
            tex.magFilter = LinearFilter;
            tex.anisotropy = this.anisotropy;
            tex.generateMipmaps = true;
            tex.needsUpdate = true;
            this.renderer.initTexture(tex);
            entry.tex = tex;
            entry.loading = undefined;
            this.onLoaded?.();
            resolve(tex);
          },
          undefined,
          (err) => {
            this.inflight--;
            this.next();
            entry.loading = undefined;
            reject(err);
          },
        );
      };
      // Small tiers jump the queue; big tiers load at most two at a time.
      if (w <= 2048 || this.inflight < 2) run();
      else this.queue.push(run);
    });
    return entry.loading;
  }

  private next(): void {
    while (this.queue.length && this.inflight < 2) this.queue.shift()!();
  }

  /** Frees large tiers that have not been used for a while. */
  evict(now: number, idleMs = 15000): void {
    for (const [key, e] of this.cache) {
      if (!e.tex || e.width <= 2048) continue;
      if (now - e.lastUsed > idleMs) {
        e.tex.dispose();
        const img = e.tex.image as ImageBitmap | undefined;
        img?.close?.();
        this.cache.delete(key);
      }
    }
  }
}

/** 1x1 placeholder texture. */
export function solidTexture(r: number, g: number, b: number, a = 255): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}
