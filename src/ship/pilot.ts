import {
  type Bone, Color, type Material, MathUtils, Matrix4, type Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D,
  Quaternion, type SkinnedMesh, Vector3,
} from 'three';

/** What the pilot reacts to, each frame. Rates are normalised to -1..1. */
export interface PilotInput {
  pitch: number;
  yaw: number;
  roll: number;
  /** -1..1, below zero is reverse */
  throttle: number;
  boost: boolean;
  /** warp spool / intensity, 0..1 */
  warp: number;
  shake: number;
  /** first-person view: the head and helmet are hidden */
  firstPerson: boolean;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _m = new Matrix4();
const _X = new Vector3(1, 0, 0);
const _Y = new Vector3(0, 1, 0);
const _Z = new Vector3(0, 0, 1);

/** Baked AO lives in the vertex colours; use it as occlusion instead of tinting the albedo. */
function vertexAo(mat: MeshStandardMaterial): MeshStandardMaterial {
  mat.vertexColors = true;
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <aomap_fragment>', /* glsl */ `#include <aomap_fragment>
{
  float vao = vColor.r;
  reflectedLight.indirectDiffuse *= vao;
  reflectedLight.indirectSpecular *= vao;
  reflectedLight.directDiffuse *= mix(1.0, vao, 0.5);
  reflectedLight.directSpecular *= mix(1.0, vao, 0.5);
}`);
  };
  mat.customProgramCacheKey = () => 'pilotAo';
  return mat;
}

function pilotMaterials(): Record<string, Material> {
  const named = (o: Record<string, Material>) => {
    for (const [k, m] of Object.entries(o)) m.name = k;
    return o;
  };
  const std = (c: [number, number, number], roughness: number, metalness = 0) =>
    vertexAo(new MeshStandardMaterial({ color: new Color(...c), roughness, metalness }));
  const paint = (c: [number, number, number]) =>
    vertexAo(new MeshPhysicalMaterial({ color: new Color(...c), roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.1 }));
  const suit = vertexAo(new MeshPhysicalMaterial({
    color: new Color(0.1, 0.11, 0.125), roughness: 0.85, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new Color(0.2, 0.22, 0.25),
  }));
  const visor = vertexAo(new MeshPhysicalMaterial({
    color: new Color(0.75, 0.55, 0.25), roughness: 0.04, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3,
  }));
  return named({
    PilotSuit: suit,
    PilotNeck: std([0.03, 0.03, 0.035], 0.85),
    PilotArmor: paint([0.78, 0.79, 0.8]),
    PilotGlove: std([0.05, 0.048, 0.045], 0.5),
    PilotBoot: std([0.03, 0.03, 0.032], 0.55),
    PilotStrap: std([0.05, 0.05, 0.056], 0.8),
    PilotBuckle: std([0.62, 0.62, 0.64], 0.28, 1),
    PilotHelmet: paint([0.82, 0.83, 0.84]),
    PilotVisor: visor,
    PilotAccent: std([0.95, 0.38, 0.06], 0.4),
    PilotStripe: std([0.95, 0.38, 0.06], 0.35),
    PilotHelmetTrim: std([0.04, 0.04, 0.045], 0.45, 0.3),
  });
}

/** Parts that would sit around the camera in the cockpit view. */
const HEAD_MATS = new Set(['PilotHelmet', 'PilotVisor', 'PilotStripe', 'PilotHelmetTrim', 'PilotNeck']);

interface Arm {
  upper: Bone;
  fore: Bone;
  hand: Bone;
  lever: Object3D;
  /** hand pose relative to its lever */
  handInLever: Matrix4;
  /** rest elbow position relative to the chest, used as the IK pole */
  poleInChest: Vector3;
  a: number;
  b: number;
}

/**
 * The seated pilot. The rig is posed from its rest pose every frame: the torso leans with the
 * motion, the levers follow the flight controls and two-bone IK keeps both hands on them.
 */
export class Pilot {
  private bones = new Map<string, Bone>();
  private rest = new Map<Bone, Quaternion>();
  private arms: Arm[] = [];
  private head: Mesh[] = [];
  private stickRest = new Quaternion();
  private throttleRest = new Quaternion();
  private gripAxis = new Vector3();
  // smoothed state
  private sm = { pitch: 0, yaw: 0, roll: 0, thr: 0.5, push: 0, lean: 0 };

  constructor(private model: Object3D, private stick: Object3D, private throttle: Object3D, pilot: Object3D) {
    const mats = pilotMaterials();
    pilot.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isMesh) return;
      const name = (m.material as Material).name.replace(/\.\d+$/, '');
      if (mats[name]) m.material = mats[name];
      m.castShadow = true;
      m.receiveShadow = true;
      // skinned bounds are computed from the bind pose; the pilot never leaves the cockpit
      m.frustumCulled = false;
      if (HEAD_MATS.has(name)) this.head.push(m);
      if (m.isSkinnedMesh) for (const b of m.skeleton.bones) this.bones.set(b.name, b);
    });
    for (const b of this.bones.values()) this.rest.set(b, b.quaternion.clone());
    this.stickRest.copy(stick.quaternion);
    this.throttleRest.copy(throttle.quaternion);
    // the grips lean forward 12 degrees; the stick twists about its own axis
    this.gripAxis.set(0, Math.cos(MathUtils.degToRad(12)), -Math.sin(MathUtils.degToRad(12)));

    model.updateMatrixWorld(true);
    const chest = this.bone('Chest');
    const chestInv = chest.matrixWorld.clone().invert();
    for (const [side, lever] of [['R', stick], ['L', throttle]] as const) {
      const upper = this.bone(`UpperArm_${side}`);
      const fore = this.bone(`ForeArm_${side}`);
      const hand = this.bone(`Hand_${side}`);
      const s = upper.getWorldPosition(new Vector3());
      const e = fore.getWorldPosition(new Vector3());
      const w = hand.getWorldPosition(new Vector3());
      this.arms.push({
        upper, fore, hand, lever,
        handInLever: lever.matrixWorld.clone().invert().multiply(hand.matrixWorld),
        poleInChest: e.clone().applyMatrix4(chestInv),
        a: s.distanceTo(e),
        b: e.distanceTo(w),
      });
    }
  }

  private bone(name: string): Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`pilot rig has no bone ${name}`);
    return b;
  }

  /** Rotates a bone by a world-space rotation (about its own head). */
  private rotateWorld(b: Bone, q: Quaternion): void {
    b.getWorldQuaternion(_q2);
    b.parent!.getWorldQuaternion(_q3);
    b.quaternion.copy(_q3.invert().multiply(q).multiply(_q2));
    b.updateMatrixWorld(true);
  }

  private setWorldQuaternion(b: Bone, q: Quaternion): void {
    b.parent!.getWorldQuaternion(_q3);
    b.quaternion.copy(_q3.invert().multiply(q));
    b.updateMatrixWorld(true);
  }

  /** Turns bone `b` so that `child` (a point it carries) moves toward `target`. */
  private aim(b: Bone, child: Vector3, target: Vector3): void {
    const head = b.getWorldPosition(_v3);
    _v.subVectors(child, head).normalize();
    _v2.subVectors(target, head).normalize();
    _q.setFromUnitVectors(_v, _v2);
    this.rotateWorld(b, _q);
  }

  update(dt: number, time: number, inp: PilotInput): void {
    for (const m of this.head) m.visible = !inp.firstPerson;
    const k = 1 - Math.exp(-dt * 9);
    const sm = this.sm;
    sm.pitch += (inp.pitch - sm.pitch) * k;
    sm.yaw += (inp.yaw - sm.yaw) * k;
    sm.roll += (inp.roll - sm.roll) * k;
    sm.thr += (inp.throttle - sm.thr) * (1 - Math.exp(-dt * 6));
    // pushed back into the seat by thrust and warp, rolled against the turn
    const push = Math.min(1, inp.warp * 0.8 + (inp.boost ? 0.35 : 0) + inp.throttle * 0.12);
    sm.push += (push - sm.push) * (1 - Math.exp(-dt * 3));
    sm.lean += (-sm.roll * 0.6 - sm.yaw * 0.4 - sm.lean) * (1 - Math.exp(-dt * 2.5));

    // levers
    _q.setFromAxisAngle(_X, sm.pitch * 0.3);
    _q2.setFromAxisAngle(_Z, sm.roll * 0.28);
    _q3.setFromAxisAngle(this.gripAxis, sm.yaw * 0.22);
    this.stick.quaternion.copy(this.stickRest).multiply(_q).multiply(_q2).multiply(_q3);
    _q.setFromAxisAngle(_X, -(sm.thr >= 0 ? sm.thr * 2 - 1 : sm.thr * 0.5 - 1) * 0.3);
    this.throttle.quaternion.copy(this.throttleRest).multiply(_q);

    // body: start from the rest pose every frame
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.model.updateMatrixWorld(true);
    const mq = this.model.getWorldQuaternion(new Quaternion());
    const axis = (v: Vector3) => _v.copy(v).applyQuaternion(mq);
    const breathe = Math.sin(time * 1.7);
    const jitter = inp.shake * 0.012;
    const spine = this.bone('Spine');
    const chest = this.bone('Chest');
    this.rotateWorld(spine, _q.setFromAxisAngle(axis(_Z), sm.lean * 0.05 + Math.sin(time * 31) * jitter));
    this.rotateWorld(spine, _q.setFromAxisAngle(axis(_X), sm.push * 0.07));
    this.rotateWorld(chest, _q.setFromAxisAngle(axis(_X), breathe * 0.012 + sm.pitch * 0.02 + Math.sin(time * 27) * jitter));
    if (!inp.firstPerson) {
      // look into the turn
      const neck = this.bone('Neck');
      const head = this.bone('Head');
      this.rotateWorld(neck, _q.setFromAxisAngle(axis(_Y), sm.yaw * 0.25 - sm.roll * 0.1));
      this.rotateWorld(head, _q.setFromAxisAngle(axis(_X), -sm.pitch * 0.08 + Math.sin(time * 0.37) * 0.03));
      this.rotateWorld(head, _q.setFromAxisAngle(axis(_Z), sm.lean * 0.12));
    }

    // arms: two-bone IK onto the grips
    this.stick.updateMatrixWorld(true);
    this.throttle.updateMatrixWorld(true);
    const target = new Vector3();
    const handQ = new Quaternion();
    const s = new Vector3();
    const e = new Vector3();
    const pole = new Vector3();
    for (const arm of this.arms) {
      _m.multiplyMatrices(arm.lever.matrixWorld, arm.handInLever);
      _m.decompose(target, handQ, _v);
      arm.upper.getWorldPosition(s);
      pole.copy(arm.poleInChest).applyMatrix4(chest.matrixWorld);
      const d = _v2.subVectors(target, s);
      const dist = MathUtils.clamp(d.length(), Math.abs(arm.a - arm.b) + 1e-4, arm.a + arm.b - 1e-4);
      d.normalize();
      const cosA = (arm.a * arm.a + dist * dist - arm.b * arm.b) / (2 * arm.a * dist);
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const pn = pole.sub(s);
      pn.addScaledVector(d, -pn.dot(d)).normalize();
      e.copy(s).addScaledVector(d, arm.a * cosA).addScaledVector(pn, arm.a * sinA);
      this.aim(arm.upper, arm.fore.getWorldPosition(new Vector3()), e);
      this.aim(arm.fore, arm.hand.getWorldPosition(new Vector3()), target);
      this.setWorldQuaternion(arm.hand, handQ);
    }
  }
}
