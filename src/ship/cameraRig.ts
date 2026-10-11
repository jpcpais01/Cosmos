import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';

export type ViewMode = 'cockpit' | 'chase' | 'far';
export const VIEW_MODES: ViewMode[] = ['cockpit', 'chase', 'far'];

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _x = new Vector3(1, 0, 0);
const _y = new Vector3(0, 1, 0);

/**
 * Camera placement in the ship's local frame (metres). The ship scene renders with `camera`;
 * the world camera copies its orientation and offset.
 */
export class CameraRig {
  mode: ViewMode = 'cockpit';
  readonly camera = new PerspectiveCamera(72, 1, 0.03, 4000);
  /** camera offset from the ship origin in world-aligned axes (metres) */
  readonly offset = new Vector3();
  /** world orientation of the camera */
  readonly quat = new Quaternion();
  /** free-look angles (rad) */
  lookYaw = 0;
  lookPitch = 0;
  private lagQuat = new Quaternion();
  private lagInit = false;
  private dragActive = false;
  private releaseTime = 0;
  /** extra pull-back / fov kick during warp */
  private kick = 0;
  fovBase = 72;

  constructor(private eye: Vector3) {}

  setEye(eye: Vector3): void {
    this.eye.copy(eye);
  }

  setMode(m: ViewMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lagInit = false;
  }

  cycle(): ViewMode {
    const i = VIEW_MODES.indexOf(this.mode);
    this.setMode(VIEW_MODES[(i + 1) % VIEW_MODES.length]);
    return this.mode;
  }

  resetLook(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  /**
   * @param look free-look drag in pixels this frame
   * @param dragging whether a free-look drag is in progress
   */
  update(dt: number, shipQuat: Quaternion, look: [number, number], dragging: boolean, warp: number, shake: number, time: number): void {
    const cockpit = this.mode === 'cockpit';
    const k = cockpit ? 0.0035 : 0.005;
    this.lookYaw -= look[0] * k;
    this.lookPitch -= look[1] * k;
    if (cockpit) {
      this.lookYaw = MathUtils.clamp(this.lookYaw, -2.4, 2.4);
      this.lookPitch = MathUtils.clamp(this.lookPitch, -1.2, 1.35);
      // gently recentre a little while after the drag ends
      if (dragging) this.dragActive = true;
      else if (this.dragActive) {
        this.dragActive = false;
        this.releaseTime = time;
      }
      if (!dragging && time - this.releaseTime > 1.2) {
        const r = 1 - Math.exp(-dt * 2.2);
        this.lookYaw -= this.lookYaw * r;
        this.lookPitch -= this.lookPitch * r;
      }
    } else {
      this.lookPitch = MathUtils.clamp(this.lookPitch, -1.4, 1.4);
    }
    this.kick += (warp - this.kick) * (1 - Math.exp(-dt * 3));

    if (cockpit) {
      this.camera.near = 0.03;
      this.camera.far = 3000;
      this.camera.fov = this.fovBase + this.kick * 10;
      _q.setFromAxisAngle(_y, this.lookYaw);
      _q2.setFromAxisAngle(_x, this.lookPitch);
      this.quat.copy(shipQuat).multiply(_q).multiply(_q2);
      // head bob from warp shake
      _v.set(Math.sin(time * 53) * 0.006, Math.cos(time * 41) * 0.006, 0).multiplyScalar(shake);
      this.offset.copy(this.eye).add(_v).applyQuaternion(shipQuat);
    } else {
      const far = this.mode === 'far';
      this.camera.near = 0.5;
      this.camera.far = 6000;
      this.camera.fov = this.fovBase - 12 + this.kick * 8;
      // lagged follow of the ship's orientation
      if (!this.lagInit) {
        this.lagQuat.copy(shipQuat);
        this.lagInit = true;
      }
      this.lagQuat.slerp(shipQuat, 1 - Math.exp(-dt * (far ? 2.5 : 3.5))).normalize();
      _q.setFromAxisAngle(_y, this.lookYaw);
      _q2.setFromAxisAngle(_x, this.lookPitch - (far ? 0.2 : 0.15));
      this.quat.copy(this.lagQuat).multiply(_q).multiply(_q2);
      const dist = (far ? 44 : 19) * (1 + this.kick * 0.35);
      // orbit around a point slightly above the ship's centre
      this.offset.set(0, 0, dist).applyQuaternion(this.quat).add(_v.set(0, far ? 1.5 : 1.0, 0).applyQuaternion(this.lagQuat));
      if (shake > 0) {
        _v.set(Math.sin(time * 37), Math.cos(time * 29), Math.sin(time * 23)).multiplyScalar(shake * 0.12);
        this.offset.add(_v);
      }
    }
    this.camera.position.copy(this.offset);
    this.camera.quaternion.copy(this.quat);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
