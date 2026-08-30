import * as THREE from 'three'
import {
  clamp,
  degToRad,
  ghostAt,
  normalize,
  radToDeg,
  reachableArc,
  type Shot,
  scale,
  sub,
  type Table,
  unit,
} from '../core'
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

export const STANDING = {
  eyeHeightM: 1.62,
  behindM: 1.3,
  hFovDeg: 55, // target horizontal; vertical derived from aspect, clamped below
  vFovClamp: [50, 70] as [number, number],
  dollyStepM: 0.1,
  dollyMaxM: 1.2,
  ndcFit: 0.95,
}

export interface CameraPose {
  eye: THREE.Vector3
  target: THREE.Vector3
  fovDeg: number
}

function verticalFov(hFovDeg: number, aspect: number): number {
  const v = 2 * Math.atan(Math.tan(degToRad(hFovDeg / 2)) / aspect)
  return clamp(radToDeg(v), STANDING.vFovClamp[0], STANDING.vFovClamp[1])
}

// Points the standing view must frame: C, O, the reachable arc, and the target pocket
// mouth when the shot was generated pocket-frameable (best effort at runtime).
function requiredPoints(shot: Shot, table: Table): THREE.Vector3[] {
  const r = table.cfg.ballRadiusMm
  const pts: THREE.Vector3[] = [toWorld(shot.cue, r), toWorld(shot.object, r)]
  const arc = reachableArc(shot.object, shot.cue, table)
  const n = Math.max(2, Math.ceil((2 * arc.halfWidth) / degToRad(15)))
  for (let i = 0; i <= n; i++) {
    const theta = arc.thetaC - arc.halfWidth + (2 * arc.halfWidth * i) / n
    pts.push(toWorld(ghostAt(theta, shot.object, r), r))
  }
  return pts
}

export function standingPose(shot: Shot, table: Table, aspect: number): CameraPose {
  const dir = normalize(sub(shot.object, shot.cue))
  const fovDeg = verticalFov(STANDING.hFovDeg, aspect)
  const pts = requiredPoints(shot, table)

  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, 30)
  const target = toWorld(shot.object, table.cfg.ballRadiusMm)

  for (let extra = 0; ; extra += STANDING.dollyStepM) {
    const back = STANDING.behindM + extra
    const eye = new THREE.Vector3(
      shot.cue.x * MM_TO_M - dir.x * back,
      BED_Y + STANDING.eyeHeightM,
      shot.cue.y * MM_TO_M - dir.y * back,
    )
    cam.position.copy(eye)
    cam.lookAt(target)
    cam.updateMatrixWorld()
    cam.updateProjectionMatrix()
    const fits = pts.every((p) => {
      const ndc = p.clone().project(cam)
      return ndc.z < 1 && Math.abs(ndc.x) <= STANDING.ndcFit && Math.abs(ndc.y) <= STANDING.ndcFit
    })
    if (fits || extra >= STANDING.dollyMaxM) {
      return { eye, target: target.clone(), fovDeg }
    }
  }
}

// Down-on-the-shot: eye behind C on the C→U line at rig height, looking at the ghost —
// the camera re-sights along the aim as the guess changes (§5).
export function downPose(shot: Shot, theta: number, table: Table, rig: DownRig): CameraPose {
  const r = table.cfg.ballRadiusMm
  const u = ghostAt(theta, shot.object, r)
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

export function chipTangentScreenX(
  camera: THREE.PerspectiveCamera,
  shot: Shot,
  theta: number,
  table: Table,
  widthPx: number,
): number {
  // screen-x movement of a small +θ step, for arrow sign resolution (§4.7)
  const r = table.cfg.ballRadiusMm
  const a = toWorld(ghostAt(theta, shot.object, r), r).project(camera)
  const b = toWorld(ghostAt(theta + degToRad(0.5), shot.object, r), r).project(camera)
  return ((b.x - a.x) * widthPx) / 2
}

export function thetaTangentHint(theta: number): { x: number; y: number } {
  return unit(theta)
}
