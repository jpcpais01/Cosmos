import {
  BufferAttribute, Color, CylinderGeometry, Group, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector2, Vector3, type BufferGeometry, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/*
 * The pilot and the flight controls they hold, in the ship model's frame (metres; x right, y up, nose at -z).
 * The body is built from simple solids around the cockpit eye point. The right hand holds a side stick
 * that tilts with the ship's turn rates, the left hand a throttle lever that follows the throttle; both
 * arms reach their grips with two-bone IK, so they move with the controls. In the cockpit view the head
 * is hidden and you see your own arms and hands on the controls.
 */

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

/** A unit-height cylinder stretched between two points each frame. */
class Limb {
  readonly mesh: Mesh;
  constructor(parent: Object3D, mat: Material, r0: number, r1: number) {
    const g = new CylinderGeometry(r1, r0, 1, 14, 1, true);
    g.translate(0, 0.5, 0);
    this.mesh = new Mesh(g, mat);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    parent.add(this.mesh);
  }
  set(from: Vector3, to: Vector3): void {
    _a.subVectors(to, from);
    const len = _a.length();
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / Math.max(len, 1e-6)));
    this.mesh.scale.set(1, len, 1);
  }
}

function ball(parent: Object3D, mat: Material, r: number, at?: Vector3): Mesh {
  const m = new Mesh(new SphereGeometry(r, 16, 12), mat);
  if (at) m.position.copy(at);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function rbox(parent: Object3D, mat: Material, w: number, h: number, d: number, r: number, at?: Vector3): Mesh {
  const m = new Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  if (at) m.position.copy(at);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Elbow position for a two-bone arm from shoulder s to wrist w, bending towards the pole direction. */
function solveElbow(s: Vector3, w: Vector3, upper: number, fore: number, pole: Vector3, out: Vector3): Vector3 {
  _a.subVectors(w, s);
  const d = Math.min(Math.max(_a.length(), 1e-4), upper + fore - 1e-4);
  _a.normalize();
  const cosA = (upper * upper + d * d - fore * fore) / (2 * upper * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // bend direction: the pole made perpendicular to the shoulder-wrist line
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)).normalize();
  return out.copy(s).addScaledVector(_a, cosA * upper).addScaledVector(_b, sinA * upper);
}

interface Arm {
  side: number;
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  upper: Limb;
  fore: Limb;
  elbowBall: Mesh;
  hand: Group;
  pole: Vector3;
}

export class Pilot {
  readonly group = new Group();
  /** what to hide in the cockpit view (the head would fill the camera) */
  private head = new Group();
  private torso = new Group();
  private arms: Arm[] = [];
  private stick = new Group();
  private lever = new Group();
  private stickGrip = new Object3D();
  private leverGrip = new Object3D();
  private defl = new Vector3();
  private thr = 0;
  private lean = new Vector2();
  private readonly upperLen = 0.4;
  private readonly foreLen = 0.37;

  constructor(eye: Vector3) {
    const suit = new MeshStandardMaterial({ color: new Color(0.42, 0.43, 0.45), roughness: 0.8, metalness: 0 });
    const suitLight = new MeshStandardMaterial({ color: new Color(0.06, 0.065, 0.075), roughness: 0.7, metalness: 0.05 });
    const accent = new MeshStandardMaterial({ color: new Color(0.95, 0.38, 0.06), roughness: 0.4, metalness: 0.05 });
    const glove = new MeshStandardMaterial({ color: new Color(0.045, 0.045, 0.05), roughness: 0.5, metalness: 0.05 });
    const helmet = new MeshPhysicalMaterial({ color: new Color(0.82, 0.83, 0.85), roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    const visor = new MeshPhysicalMaterial({ color: new Color(0.02, 0.025, 0.04), roughness: 0.05, metalness: 0.9, envMapIntensity: 1.4 });
    const metal = new MeshStandardMaterial({ color: new Color(0.5, 0.5, 0.53), roughness: 0.3, metalness: 1 });
    const dark = new MeshStandardMaterial({ color: new Color(0.035, 0.037, 0.042), roughness: 0.45, metalness: 0.6 });
    const lamp = new MeshBasicMaterial({ color: new Color(1.0, 0.55, 0.18).multiplyScalar(2.2) });
    const g = this.group;
    g.name = 'Pilot';

    // --- body (positions from the eye point, which sits at the front of the helmet)
    const headC = eye.clone().add(new Vector3(0, -0.02, 0.1));
    const neck = new Vector3(0, eye.y - 0.24, eye.z + 0.14);
    const pelvis = new Vector3(0, 0.62, eye.z + 0.22);
    this.torso.position.copy(pelvis);
    g.add(this.torso);

    // torso: a lathed shell, wider at the chest, flattened front to back
    const prof: Vector2[] = [];
    const h = neck.distanceTo(pelvis);
    for (const [r, y] of [[0.0, 0], [0.15, 0.0], [0.17, 0.12], [0.2, 0.32], [0.215, 0.5], [0.2, 0.62], [0.13, 0.69], [0.07, 0.72]] as const)
      prof.push(new Vector2(r, (y / 0.72) * h));
    const torsoMesh = new Mesh(new LatheGeometry(prof, 24), suit);
    torsoMesh.scale.set(1.12, 1, 0.72);
    torsoMesh.castShadow = torsoMesh.receiveShadow = true;
    // lean the torso from the pelvis toward the neck
    const torsoDir = _a.subVectors(neck, pelvis).normalize();
    const torsoAxis = new Group();
    torsoAxis.quaternion.setFromUnitVectors(UP, torsoDir);
    torsoAxis.add(torsoMesh);
    this.torso.add(torsoAxis);
    // harness and chest unit
    rbox(torsoAxis, suitLight, 0.3, 0.2, 0.06, 0.02, new Vector3(0, h * 0.62, -0.135));
    rbox(torsoAxis, accent, 0.06, 0.04, 0.02, 0.008, new Vector3(-0.07, h * 0.66, -0.17));
    ball(torsoAxis, lamp, 0.008, new Vector3(0.07, h * 0.66, -0.168));
    for (const sx of [-1, 1]) {
      const strap = rbox(torsoAxis, suitLight, 0.05, h * 0.7, 0.02, 0.008, new Vector3(sx * 0.1, h * 0.45, -0.145));
      strap.rotation.z = sx * 0.12;
    }
    rbox(torsoAxis, suitLight, 0.36, 0.07, 0.26, 0.025, new Vector3(0, 0.06, 0)); // belt

    // head: neck, helmet, visor
    this.torso.add(this.head);
    this.head.position.copy(neck).sub(pelvis);
    const neckMesh = new Mesh(new CylinderGeometry(0.06, 0.07, 0.12, 12), suit);
    neckMesh.position.set(0, 0.04, 0);
    this.head.add(neckMesh);
    const helm = new Group();
    helm.position.copy(headC).sub(neck);
    this.head.add(helm);
    const shell = ball(helm, helmet, 0.15);
    shell.scale.set(0.95, 1.02, 1.08);
    const vis = new Mesh(new SphereGeometry(0.153, 24, 16, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.38), visor);
    vis.scale.set(0.96, 1.02, 1.1);
    helm.add(vis);
    rbox(helm, accent, 0.03, 0.02, 0.2, 0.008, new Vector3(0, 0.148, 0.03)); // crest stripe
    rbox(helm, dark, 0.13, 0.05, 0.08, 0.015, new Vector3(0, -0.12, -0.07)); // chin guard / mask

    // legs (fixed: seated, feet on the floor)
    for (const sx of [-1, 1]) {
      const hip = new Vector3(sx * 0.13, 0.58, pelvis.z - 0.05);
      const knee = new Vector3(sx * 0.17, 0.68, eye.z - 0.48);
      const ankle = new Vector3(sx * 0.18, 0.22, eye.z - 0.8);
      new Limb(g, suit, 0.085, 0.07).set(hip, knee);
      new Limb(g, suit, 0.065, 0.05).set(knee, ankle);
      ball(g, suitLight, 0.075, knee);
      const boot = rbox(g, dark, 0.11, 0.1, 0.26, 0.04, ankle.clone().add(new Vector3(0, -0.04, -0.07)));
      boot.rotation.x = -0.1;
    }

    // --- controls: a side stick on the right console, a throttle lever on the left
    const stickPivot = new Vector3(0.44, 1.08, eye.z - 0.62);
    const leverPivot = new Vector3(-0.44, 1.04, eye.z - 0.56);
    for (const [pivot, side] of [[stickPivot, 1], [leverPivot, -1]] as const) {
      const base = new Vector3(side * 0.5, 0.74, pivot.z - 0.1);
      new Limb(g, dark, 0.035, 0.026).set(base, pivot.clone().add(new Vector3(0, -0.03, 0)));
      const plate = new Mesh(new CylinderGeometry(0.06, 0.07, 0.02, 20), dark);
      plate.position.copy(base);
      g.add(plate);
      const boot = new Mesh(new CylinderGeometry(0.03, 0.045, 0.05, 16), suit);
      boot.position.copy(pivot).add(new Vector3(0, -0.02, 0));
      g.add(boot);
    }
    this.stick.position.copy(stickPivot);
    g.add(this.stick);
    const sGrip = rbox(this.stick, dark, 0.055, 0.17, 0.07, 0.025, new Vector3(0, 0.1, 0));
    sGrip.rotation.x = 0.12;
    rbox(this.stick, metal, 0.03, 0.02, 0.03, 0.008, new Vector3(0, 0.19, -0.01)); // hat switch
    ball(this.stick, lamp, 0.007, new Vector3(-0.02, 0.185, -0.02));
    rbox(this.stick, accent, 0.012, 0.035, 0.012, 0.004, new Vector3(0, 0.12, -0.04)); // trigger
    this.stickGrip.position.set(0, 0.1, 0);
    this.stick.add(this.stickGrip);

    this.lever.position.copy(leverPivot);
    g.add(this.lever);
    new Limb(this.lever, metal, 0.016, 0.016).set(new Vector3(), new Vector3(0, 0.1, 0));
    rbox(this.lever, dark, 0.075, 0.06, 0.11, 0.025, new Vector3(0, 0.12, 0));
    ball(this.lever, lamp, 0.007, new Vector3(0.03, 0.15, -0.03));
    rbox(this.lever, accent, 0.012, 0.012, 0.03, 0.004, new Vector3(-0.03, 0.15, -0.02));
    this.leverGrip.position.set(0, 0.12, 0);
    this.lever.add(this.leverGrip);

    // --- arms and gloved hands
    for (const side of [-1, 1]) {
      const shoulder = new Vector3(side * 0.25, neck.y - 0.08, neck.z - 0.01);
      ball(g, suit, 0.085, shoulder);
      const hand = new Group();
      // a gloved fist wrapped around the grip (local -z points from the wrist to the grip centre)
      const o = side; // the back of the hand faces outboard
      rbox(hand, glove, 0.03, 0.1, 0.09, 0.012, new Vector3(o * 0.04, 0, -0.07)); // palm / back of hand
      rbox(hand, accent, 0.006, 0.03, 0.04, 0.003, new Vector3(o * 0.056, 0.02, -0.06)); // knuckle guard stripe
      const joint = (p: Vector3, r: number) => ball(hand, glove, r, p);
      for (let i = 0; i < 4; i++) {
        const y = 0.036 - i * 0.024;
        const r = i === 3 ? 0.0095 : 0.011;
        const k0 = new Vector3(o * 0.035, y, -0.118);
        const k1 = new Vector3(-o * 0.005, y, -0.13);
        const k2 = new Vector3(-o * 0.038, y, -0.105);
        new Limb(hand, glove, r, r).set(k0, k1);
        new Limb(hand, glove, r, r * 0.9).set(k1, k2);
        joint(k0, r); joint(k1, r); joint(k2, r * 0.9);
      }
      const t0 = new Vector3(o * 0.03, 0.045, -0.04);
      const t1 = new Vector3(o * 0.0, 0.062, -0.075);
      const t2 = new Vector3(-o * 0.012, 0.064, -0.105);
      new Limb(hand, glove, 0.014, 0.012).set(t0, t1);
      new Limb(hand, glove, 0.012, 0.011).set(t1, t2);
      joint(t1, 0.013); joint(t2, 0.011);
      const cuff = new Mesh(new CylinderGeometry(0.046, 0.05, 0.07, 16), glove);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, 0, 0.0);
      cuff.castShadow = true;
      hand.add(cuff);
      g.add(hand);
      this.arms.push({
        side, shoulder, elbow: new Vector3(), wrist: new Vector3(),
        upper: new Limb(g, suit, 0.058, 0.05), fore: new Limb(g, suit, 0.05, 0.04),
        elbowBall: ball(g, suit, 0.052), hand,
        pole: new Vector3(side * 0.6, -1, 0.35).normalize(),
      });
    }
    this.update(0, new Vector3(), 0, 0, false);
  }

  /**
   * @param rates the ship's turn rates as fractions of the maximum (x pitch, y yaw, z roll)
   * @param throttle 0..1
   */
  update(dt: number, rates: Vector3, throttle: number, time: number, firstPerson: boolean): void {
    const k = dt > 0 ? 1 - Math.exp(-dt * 10) : 1;
    this.defl.lerp(rates, k);
    this.thr += (throttle - this.thr) * k;
    // stick: forward/back for pitch, sideways for roll, a twist for yaw
    this.stick.rotation.set(this.defl.x * 0.32, this.defl.y * 0.3, this.defl.z * 0.3 + this.defl.y * 0.08);
    this.lever.rotation.x = 0.4 - this.thr * 0.85;

    // the body leans against the turns a little and breathes
    const kl = dt > 0 ? 1 - Math.exp(-dt * 3) : 1;
    this.lean.x += (-this.defl.z * 0.05 - this.defl.y * 0.03 - this.lean.x) * kl;
    this.lean.y += (this.defl.x * 0.03 - this.lean.y) * kl;
    this.torso.rotation.set(this.lean.y + Math.sin(time * 1.4) * 0.006, 0, this.lean.x);
    this.head.rotation.set(this.defl.x * 0.06, this.defl.y * 0.22 + Math.sin(time * 0.23) * 0.05, this.defl.z * 0.08);
    this.head.visible = !firstPerson;

    this.torso.updateMatrix();
    for (const arm of this.arms) {
      const grip = arm.side > 0 ? this.stickGrip : this.leverGrip;
      grip.updateWorldMatrix(true, false);
      // grip centre and orientation in the pilot's frame
      this.group.updateWorldMatrix(true, false);
      _m.copy(this.group.matrixWorld).invert().multiply(grip.matrixWorld);
      const gripPos = _c.setFromMatrixPosition(_m);
      // the wrist sits behind the grip (towards the pilot) and slightly outboard
      _d.set(arm.side * 0.015, -0.005, 0.085).applyQuaternion(_q.setFromRotationMatrix(_m));
      arm.wrist.copy(gripPos).add(_d);
      // shoulders ride on the leaning torso
      const sh = _b.copy(arm.shoulder).sub(this.torso.position).applyMatrix4(_m.makeRotationFromEuler(this.torso.rotation)).add(this.torso.position);
      const shoulder = arm.shoulder.clone().copy(sh);
      solveElbow(shoulder, arm.wrist, this.upperLen, this.foreLen, arm.pole, arm.elbow);
      arm.upper.set(shoulder, arm.elbow);
      arm.fore.set(arm.elbow, arm.wrist);
      arm.elbowBall.position.copy(arm.elbow);
      // hand: from the wrist toward the grip, back of the hand outward
      arm.hand.position.copy(arm.wrist);
      _m.lookAt(arm.wrist, gripPos, UP);
      arm.hand.quaternion.setFromRotationMatrix(_m);
    }
  }
}

/**
 * Removes the model's original throttle and stick (baked into the cockpit mesh) by dropping the triangles
 * inside their boxes, so the animated controls can take their place.
 */
export function removeBakedControls(meshes: Mesh[], root: Object3D): void {
  // model-space boxes [min, max] around the old throttle and stick
  const boxes = [
    [new Vector3(-0.71, 0.69, -2.86), new Vector3(-0.49, 1.09, -2.52)],
    [new Vector3(0.49, 0.69, -2.73), new Vector3(0.71, 1.14, -2.52)],
  ];
  root.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const p = new Vector3();
  for (const m of meshes) {
    const geo = m.geometry as BufferGeometry;
    const pos = geo.attributes.position;
    const index = geo.index;
    if (!pos || !index) continue;
    const toRoot = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const inside = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      inside[i] = boxes.some(([lo, hi]) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y && p.z >= lo.z && p.z <= hi.z) ? 1 : 0;
    }
    const src = index.array;
    const kept: number[] = [];
    for (let t = 0; t < src.length; t += 3) {
      if (inside[src[t]] && inside[src[t + 1]] && inside[src[t + 2]]) continue;
      kept.push(src[t], src[t + 1], src[t + 2]);
    }
    if (kept.length === src.length) continue;
    const arr = pos.count > 65535 ? new Uint32Array(kept) : new Uint16Array(kept);
    geo.setIndex(new BufferAttribute(arr, 1));
    // clear any groups that indexed the old buffer
    if (geo.groups.length) geo.clearGroups();
  }
}
