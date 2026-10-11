import {
  BufferAttribute, BufferGeometry, CustomBlending, Matrix3, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera,
  Quaternion, Scene, ShaderMaterial, AddEquation, Vector2, type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { MATH } from './glsl';

/*
 * The interstellar jump: a hyperspace tunnel, nothing like the in-system warp's streaks. Each view ray is
 * traced to the wall of a cylinder around the direction of travel; the wall is a river of plasma in deep
 * violet and magenta, twisted into a slow spiral, threaded with gold filaments, crossed by rings of cyan
 * light that rush past, cracked by lightning, and it all pours toward a white-hot point far ahead.
 * Every angle-based pattern is sampled on (cos, sin) of the angle, so nothing has a seam where atan wraps.
 * It is drawn into the HDR buffer before the ship, so the hull and the canopy frame hide it naturally.
 */
const FRAG = /* glsl */ `
${MATH}
varying vec2 vNdc;
uniform vec2 uTan;      // tangents of the half field of view
uniform mat3 uCamToTunnel;
uniform float uTime;
uniform float uTravel;   // distance flown down the tunnel (tunnel radii)
uniform float uSpeed;    // 0..1 how hard it is rushing
uniform float uAlpha;    // fade in and out
uniform float uGain;
uniform float uSeed;

// rotates (cos, sin) by an angle
vec2 rot(vec2 cs, float a) { float c = cos(a), s = sin(a); return vec2(cs.x * c - cs.y * s, cs.x * s + cs.y * c); }

float ridge(float n) { return 1.0 - abs(n * 2.0 - 1.0); }

void main() {
  // view ray from the camera basis (inverting the projection is too imprecise with the planets' depth range)
  vec3 d = normalize(uCamToTunnel * vec3(vNdc * uTan, -1.0));
  // tunnel axis is -Z (forward); hit the wall of a unit cylinder
  float fw = -d.z;
  float rr = max(length(d.xy), 1e-4);
  float t = 1.0 / rr;
  float z = fw * t;                       // how far ahead the wall point is
  vec2 cs = d.xy / rr;
  float s = z + uTravel;                  // wall coordinate along the tunnel
  float fade = exp(-max(z, 0.0) * 0.06); // far wall dims into the glow ahead
  // the plasma spirals slowly; twist grows with the rush
  float twist = s * (0.11 + 0.05 * uSpeed) + uTime * 0.35;
  vec2 sp = rot(cs, twist);
  vec3 so = vec3(uSeed * 31.0, uSeed * 17.0, 0.0);
  float n1 = fbm3(vec3(sp * 1.6, s * 0.09) + so);
  float n2 = fbm3(vec3(rot(cs, -twist * 0.6) * 3.4, s * 0.21 - uTime * 0.4) + so.yxz);
  // gold filaments: ridged noise, long along the tunnel
  float fil = pow(ridge(vnoise3(vec3(rot(cs, twist * 1.3) * 5.0, s * 0.05 + n1 * 1.5) + so)), 14.0);
  fil += 0.6 * pow(ridge(vnoise3(vec3(rot(cs, -twist) * 9.0, s * 0.08 - uTime * 0.2) + so.zxy)), 22.0);
  // rings of light rushing past
  float ringPh = s * 0.32 + n1 * 1.2;
  float rings = pow(0.5 + 0.5 * cos(ringPh * TAU), 40.0) * (0.4 + 0.8 * n2);
  // lightning: rare, sudden, bright cracks along the wall
  float strikeT = floor(uTime * 7.0);
  float strike = step(0.82, hash12(vec2(strikeT, uSeed * 53.0)));
  float bolt = pow(ridge(vnoise3(vec3(rot(cs, hash12(vec2(strikeT, 3.1)) * 6.28) * 6.0, s * 0.6 + strikeT * 1.7))), 60.0);
  bolt *= strike * smoothstep(40.0, 5.0, z);
  // streaks of light in lanes, rushing past (a whole number of lanes round the circle)
  float lane = (atan(cs.y, cs.x) / TAU + 0.5) * 64.0;
  float li = floor(lane);
  float lf = fract(lane);
  float dash = fract(s * 0.07 + hash12(vec2(li, uSeed * 7.0)) * 9.0);
  float streak = step(0.72, hash12(vec2(li, 11.0 + uSeed))) * smoothstep(0.5, 0.0, abs(lf - 0.5)) * pow(smoothstep(0.75, 1.0, dash), 2.0) * smoothstep(1.0, 0.97, dash);

  vec3 deep = vec3(0.05, 0.015, 0.14);
  vec3 violet = vec3(0.42, 0.08, 0.9);
  vec3 magenta = vec3(1.0, 0.16, 0.55);
  vec3 gold = vec3(1.0, 0.68, 0.25);
  vec3 cyan = vec3(0.3, 0.85, 1.0);
  vec3 col = mix(deep, violet, smoothstep(0.25, 0.75, n1));
  col = mix(col, magenta, smoothstep(0.55, 0.85, n2) * 0.7);
  col *= (0.6 + 1.6 * n1 * n2) * 0.22;
  col += gold * fil * 1.3;
  col += cyan * rings * (0.4 + 0.9 * uSpeed);
  col += vec3(0.8, 0.85, 1.0) * streak * (0.8 + 1.6 * uSpeed);
  col += vec3(0.85, 0.8, 1.0) * bolt * 9.0;
  col *= fade;
  // the light at the end of the tunnel
  float off = rr / max(fw, 1e-3);          // tangent of the angle off the axis
  float core = fw > 0.0 ? exp(-off * off * 80.0) * 3.0 + exp(-off * 7.0) * 0.3 : 0.0;
  vec3 coreCol = mix(vec3(1.0, 0.95, 1.0), vec3(0.7, 0.45, 1.0), smoothstep(0.0, 0.4, off));
  col += coreCol * core * (0.6 + 0.4 * sin(uTime * 3.0) * sin(uTime * 1.7));
  // looking back: the tunnel recedes into darkness
  col *= mix(0.25, 1.0, smoothstep(-0.6, 0.2, fw));
  gl_FragColor = vec4(col * uGain * uAlpha, uAlpha);
}`;

const _m4 = new Matrix4();
const _q = new Quaternion();

export class GateTunnel {
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  /** the direction of travel, fixed when the jump starts (world orientation of the tunnel's -Z axis) */
  readonly frame = new Quaternion();

  constructor() {
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mat = new ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
      // premultiplied over whatever is behind it while it fades in and out
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uTan: { value: new Vector2() }, uCamToTunnel: { value: new Matrix3() }, uTime: { value: 0 }, uTravel: { value: 0 },
        uSpeed: { value: 0 }, uAlpha: { value: 0 }, uGain: { value: 1 }, uSeed: { value: 0 },
      },
    });
    const quad = new Mesh(tri, this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Compiles the shader ahead of the first jump. */
  compile(renderer: WebGLRenderer): void {
    renderer.compile(this.scene, this.cam);
  }

  render(renderer: WebGLRenderer, camera: PerspectiveCamera, camQ: Quaternion, p: {
    time: number; travel: number; speed: number; alpha: number; gain: number; seed: number;
  }): void {
    if (p.alpha <= 0.001) return;
    const u = this.mat.uniforms;
    const pe = camera.projectionMatrix.elements;
    (u.uTan.value as Vector2).set(1 / pe[0], 1 / pe[5]);
    // camera space -> tunnel space
    _q.copy(this.frame).invert().multiply(camQ);
    (u.uCamToTunnel.value as Matrix3).setFromMatrix4(_m4.makeRotationFromQuaternion(_q));
    u.uTime.value = p.time;
    u.uTravel.value = p.travel;
    u.uSpeed.value = p.speed;
    u.uAlpha.value = Math.min(1, p.alpha);
    u.uGain.value = p.gain;
    u.uSeed.value = p.seed;
    renderer.render(this.scene, this.cam);
  }
}
