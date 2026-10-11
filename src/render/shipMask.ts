import {
  BackSide, DoubleSide, LinearFilter, MeshBasicMaterial, RedFormat, UnsignedByteType, WebGLRenderTarget,
  type Camera, type Mesh, type Object3D, type Scene, type Texture, type WebGLRenderer,
} from 'three';

/** Layers the solid ship parts are also put on, split by face culling so the mask matches what gets drawn. */
const LAYER_FRONT = 1;
const LAYER_DOUBLE = 2;

/**
 * Shared by the sky and planet materials: when on, they skip pixels the cockpit will cover anyway.
 * The same objects sit in each material's uniforms, so setting them here reaches all of them.
 */
export const shipMaskUniforms = {
  uShipMask: { value: null as Texture | null },
  uShipMaskOn: { value: 0 },
};

/**
 * GLSL: true where the solid ship covers this pixel and its four neighbours. Two bilinear taps at
 * opposite pixel corners each average a 2x2 block, so both read 1 only inside the eroded mask; that
 * one-pixel margin keeps a pixel the ship pass might not cover at a silhouette edge from being skipped.
 */
export const SHIP_MASK = /* glsl */ `
uniform sampler2D uShipMask;
uniform float uShipMaskOn;
bool behindShip() {
  if (uShipMaskOn < 0.5) return false;
  vec2 texel = 1.0 / vec2(textureSize(uShipMask, 0));
  vec2 uv = gl_FragCoord.xy * texel;
  return min(textureLod(uShipMask, uv + 0.5 * texel, 0.0).r, textureLod(uShipMask, uv - 0.5 * texel, 0.0).r) > 0.99;
}`;

/**
 * Silhouette of the solid cockpit and hull, drawn before the world so the costly sky and planet
 * shaders can skip what the ship then paints over. Planets write their own depth, which turns off
 * the GPU's early depth test, so a mask the shaders check themselves is the only way to skip them.
 */
export class ShipMask {
  readonly target = new WebGLRenderTarget(1, 1, {
    format: RedFormat, type: UnsignedByteType, depthBuffer: false,
    minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
  });
  private front = new MeshBasicMaterial({ color: 0xffffff });
  private double = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });

  constructor() {
    for (const m of [this.front, this.double]) {
      m.depthTest = false;
      m.depthWrite = false;
    }
    shipMaskUniforms.uShipMask.value = this.target.texture;
  }

  /** Puts every opaque mesh under root into the mask (glass and other see-through parts stay out). */
  add(root: Object3D): void {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const side = mats[0].side;
      if (mats.some((x) => x.transparent || x.alphaTest > 0 || x.side !== side || !x.colorWrite || !x.depthWrite)) return;
      if (side === BackSide) return;
      m.layers.enable(side === DoubleSide ? LAYER_DOUBLE : LAYER_FRONT);
    });
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }

  /** Draws the mask for this frame with the camera the ship pass will use. */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const layers = camera.layers.mask;
    const shadows = renderer.shadowMap.needsUpdate;
    const override = scene.overrideMaterial;
    renderer.shadowMap.needsUpdate = false; // the shadow map is for the real ship pass
    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    camera.layers.set(LAYER_FRONT);
    scene.overrideMaterial = this.front;
    renderer.render(scene, camera);
    camera.layers.set(LAYER_DOUBLE);
    scene.overrideMaterial = this.double;
    renderer.render(scene, camera);
    camera.layers.mask = layers;
    scene.overrideMaterial = override;
    renderer.shadowMap.needsUpdate = shadows;
  }
}
