import * as THREE from 'three'
import { fitStandingZoom, normalize, type Shot, scale, sub, type Table, type Vec2 } from '../core'
import { BED_Y, MM_TO_M, toWorld } from './units'

// Camera rigs (PLAN.md §2.11). All constants live here. The standing rig starts from the
// §4.10 canonical pose; at runtime the camera dollies straight back until every required
// point fits the actual viewport (§5) — generation stays device-independent. The down rig
// candidates D1/D2/D3 are switchable via ?rig= for the M3 on-device A/B; D3 is provisional.

export interface DownRig {
  heightM: number // eye above bed
  behindM: number // behind the cue ball along the aim line
  fovDeg: number // vertical FOV
}

export const DOWN_RIGS: Record<string, DownRig> = {
  d1: { heightM: 0.17, behindM: 1.0, fovDeg: 50 },
  d2: { heightM: 0.28, behindM: 0.35, fovDeg: 45 },
  d3: { heightM: 0.22, behindM: 0.9, fovDeg: 48 },
}

export interface CameraPose {
  eye: THREE.Vector3
  target: THREE.Vector3
  fovDeg: number
}

// V2 zoom framing: the pose comes from core's fitStandingZoom — the same math the
// generator's frameability check uses, run at the actual viewport aspect. Maximum zoom
// with the pocket + the whole placement region visible (docs/decisions.md).
export function standingPose(shot: Shot, table: Table, aspect: number): CameraPose {
  const fit = fitStandingZoom(shot.cue, shot.object, shot.pocketId, table, aspect)
  const eye = new THREE.Vector3(
    fit.eye.x * MM_TO_M,
    BED_Y + fit.eye.z * MM_TO_M,
    fit.eye.y * MM_TO_M,
  )
  const target = eye
    .clone()
    .add(new THREE.Vector3(fit.look.x, fit.look.z, fit.look.y).multiplyScalar(2))
  return { eye, target, fovDeg: fit.vFovDeg }
}

// Down-on-the-shot: eye behind C on the C→U line at rig height, looking at the ghost —
// the camera re-sights along the aim as the guess changes (§5).
export function downPose(shot: Shot, u: Vec2, table: Table, rig: DownRig): CameraPose {
  const r = table.cfg.ballRadiusMm
  const aim = normalize(sub(u, shot.cue))
  const back = scale(aim, -rig.behindM / MM_TO_M)
  const eye = new THREE.Vector3(
    (shot.cue.x + back.x) * MM_TO_M,
    BED_Y + rig.heightM,
    (shot.cue.y + back.y) * MM_TO_M,
  )
  return { eye, target: toWorld(u, r), fovDeg: rig.fovDeg }
}

// Exponential smoothing toward a target pose — the down camera's ~150 ms damped follow
// (§2.4) and the standing↔down transition both run through this.
export class DampedCamera {
  readonly camera: THREE.PerspectiveCamera
  private targetPose: CameraPose | null = null
  private tau = 0.15

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.05, 30)
  }

  snapTo(pose: CameraPose): void {
    this.targetPose = pose
    this.camera.position.copy(pose.eye)
    this.camera.lookAt(pose.target)
    this.camera.fov = pose.fovDeg
    this.camera.updateProjectionMatrix()
  }

  moveTo(pose: CameraPose, tauSeconds = 0.15): void {
    this.targetPose = pose
    this.tau = tauSeconds
  }

  // Advance toward the target; returns true while still moving (keeps the render loop dirty).
  update(dt: number): boolean {
    const pose = this.targetPose
    if (!pose) return false
    const k = 1 - Math.exp(-dt / this.tau)
    this.camera.position.lerp(pose.eye, k)
    this.camera.fov += (pose.fovDeg - this.camera.fov) * k
    this.camera.updateProjectionMatrix()

    // damp the look target through a virtual point ahead of the camera
    const currentDir = new THREE.Vector3()
    this.camera.getWorldDirection(currentDir)
    const lookDist = this.camera.position.distanceTo(pose.target)
    const currentTarget = this.camera.position.clone().addScaledVector(currentDir, lookDist)
    currentTarget.lerp(pose.target, k)
    this.camera.lookAt(currentTarget)

    const settled =
      this.camera.position.distanceTo(pose.eye) < 0.001 &&
      currentTarget.distanceTo(pose.target) < 0.001 &&
      Math.abs(this.camera.fov - pose.fovDeg) < 0.05
    if (settled) {
      this.camera.position.copy(pose.eye)
      this.camera.lookAt(pose.target)
      this.camera.fov = pose.fovDeg
      this.camera.updateProjectionMatrix()
      this.targetPose = null
      return false
    }
    return true
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  poseFor(_stance: 'standing' | 'down'): CameraPose | null {
    return this.targetPose
  }
}

export function pickDownRig(): DownRig {
  const q = new URLSearchParams(location.search).get('rig')
  const rig = q ? DOWN_RIGS[q] : undefined
  return rig ?? (DOWN_RIGS.d3 as DownRig)
}

// Table-space unit vectors for "screen right" and "screen up" at the ghost's position —
// resolves the 4-way nudge arrows and the down-view swipe into table mm (v2 2D nudges).
export function screenDirsOnTable(
  camera: THREE.PerspectiveCamera,
  ghostPos: Vec2,
  table: Table,
): { right: Vec2; up: Vec2 } {
  const r = table.cfg.ballRadiusMm
  const planeY = BED_Y + r * MM_TO_M
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const origin = toWorld(ghostPos, r)
  const ndc = origin.clone().project(camera)
  const raycaster = new THREE.Raycaster()
  const hit = new THREE.Vector3()
  const castDelta = (dx: number, dy: number): Vec2 | null => {
    raycaster.setFromCamera(new THREE.Vector2(ndc.x + dx, ndc.y + dy), camera)
    const p = raycaster.ray.intersectPlane(plane, hit)
    if (!p) return null
    const v = { x: (p.x - origin.x) / MM_TO_M, y: (p.z - origin.z) / MM_TO_M }
    const len = Math.hypot(v.x, v.y)
    return len > 1e-9 ? { x: v.x / len, y: v.y / len } : null
  }
  const right = castDelta(0.05, 0) ?? { x: 1, y: 0 }
  const up = castDelta(0, 0.05) ?? { x: 0, y: 1 }
  return { right, up }
}
