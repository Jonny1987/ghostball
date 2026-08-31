import * as THREE from 'three'
import {
  fitStandingZoom,
  normalize,
  radToDeg,
  type Shot,
  sub,
  type Table,
  type Vec2,
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

export interface CameraPose {
  eye: THREE.Vector3
  target: THREE.Vector3
  fovDeg: number
}

// V2 zoom framing: the pose comes from core's fitStandingZoom — the same math the
// generator's frameability check uses, run at the actual viewport aspect. Maximum zoom
// with the pocket + the whole placement region visible; the look yaws to put the GHOST
// at the horizontal screen centre while the zoom stays constant per shot (v2.2).
export function standingPose(
  shot: Shot,
  table: Table,
  aspect: number,
  ghostPos?: Vec2,
): CameraPose {
  const fit = fitStandingZoom(
    shot.cue,
    shot.object,
    shot.pocketId,
    table,
    aspect,
    undefined,
    ghostPos,
  )
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

// Down-view pocket fit (v2.2, ghost-centred v2.5): the pose must show the TARGET
// POCKET together with the ghost + object ball, with the GHOST at the horizontal screen
// centre (matching the standing view). The eye stays ON the aim line behind the cue
// ball — that is the stance's identity (in plan view eye, C and U are collinear, so the
// cue→ghost alignment always reads as the aim) — while the look yaws onto the ghost,
// centres the box vertically, and the FOV widens from the rig's natural value as needed
// (measured from the ghost, so the pocket fits off to one side).
const DOWN_FIT = {
  margin: 1.15, // slight margin around the required points
  maxVFovDeg: 66, // widest before the view reads as fisheye
  maxBehindM: 3.0, // furthest the eye dollies back along the aim line to make it fit
}

// Points the down view must frame: ghost + object ball (bottom, top, ±r sides) and the
// pocket mouth. The cue ball needs no entry — it sits between the eye and the ghost and
// lands in the lower foreground by construction.
function downRequiredPoints(shot: Shot, u: Vec2, table: Table): THREE.Vector3[] {
  const r = table.cfg.ballRadiusMm
  const pts: THREE.Vector3[] = []
  for (const c of [u, shot.object]) {
    pts.push(toWorld(c, 0), toWorld(c, 2 * r))
    pts.push(toWorld({ x: c.x + r, y: c.y }, r), toWorld({ x: c.x - r, y: c.y }, r))
    pts.push(toWorld({ x: c.x, y: c.y + r }, r), toWorld({ x: c.x, y: c.y - r }, r))
  }
  const pk = table.pockets[shot.pocketId]
  if (pk) pts.push(toWorld(pk.j1, 0), toWorld(pk.j2, 0), toWorld(pk.m, 0))
  return pts
}

// Gnomonic fit from a fixed eye (same scheme as core's fitStandingZoom): two steering
// iterations yaw the look onto the GHOST horizontally and the box centre vertically;
// the horizontal FOV is measured from the ghost's screen position, so the needed FOV
// is exactly what keeps the pocket in frame with the ghost dead-centre (v2.5).
function fitDownView(
  eye: THREE.Vector3,
  ghostW: THREE.Vector3,
  pts: THREE.Vector3[],
  aspect: number,
): { look: THREE.Vector3; neededVFovDeg: number } {
  let forward = ghostW.clone().sub(eye).normalize()
  const worldUp = new THREE.Vector3(0, 1, 0)
  const v = new THREE.Vector3()
  let tanH = 0
  let tanV = 0
  for (let iter = 0; iter < 2; iter++) {
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward)
    v.copy(ghostW).sub(eye)
    const xG = v.dot(right) / v.dot(forward)
    let tanHMax = 0
    let yMin = Number.POSITIVE_INFINITY
    let yMax = Number.NEGATIVE_INFINITY
    for (const p of pts) {
      v.copy(p).sub(eye)
      const zc = v.dot(forward)
      if (zc <= 0.01) return { look: forward, neededVFovDeg: Number.POSITIVE_INFINITY }
      const d = Math.abs(v.dot(right) / zc - xG)
      if (d > tanHMax) tanHMax = d
      const yt = v.dot(up) / zc
      if (yt < yMin) yMin = yt
      if (yt > yMax) yMax = yt
    }
    tanH = tanHMax * DOWN_FIT.margin
    tanV = ((yMax - yMin) / 2) * DOWN_FIT.margin
    forward = forward
      .add(right.multiplyScalar(xG))
      .add(up.multiplyScalar((yMin + yMax) / 2))
      .normalize()
  }
  const neededVFovDeg = 2 * radToDeg(Math.atan(Math.max(tanV, tanH / aspect)))
  return { look: forward, neededVFovDeg }
}

// Down-on-the-shot: eye behind C on the C→U line at rig height, re-sighting as the
// guess changes (§5). v2.2: FOV widens up to DOWN_FIT.maxVFovDeg to include the pocket;
// still too wide → dolly straight back along the aim line (receding narrows the angular
// spread) up to maxBehindM; in the degenerate remainder (a near-perpendicular pocket on
// a narrow screen cannot share the frame with a centred ghost) fall back to the classic
// ghost-look pose — still ghost-centred, and the edge chevron covers the pocket.
export function downPose(
  shot: Shot,
  u: Vec2,
  table: Table,
  rig: DownRig,
  aspect: number,
): CameraPose {
  const r = table.cfg.ballRadiusMm
  const aim = normalize(sub(u, shot.cue))
  const aimW = new THREE.Vector3(aim.x, 0, aim.y)
  const cueW = toWorld(shot.cue, r)
  const ghostW = toWorld(u, r)
  const eyeAt = (behindM: number): THREE.Vector3 =>
    new THREE.Vector3(cueW.x - aimW.x * behindM, BED_Y + rig.heightM, cueW.z - aimW.z * behindM)
  const pts = downRequiredPoints(shot, u, table)

  let behind = rig.behindM
  let fit = fitDownView(eyeAt(behind), ghostW, pts, aspect)
  if (fit.neededVFovDeg > DOWN_FIT.maxVFovDeg) {
    if (
      fitDownView(eyeAt(DOWN_FIT.maxBehindM), ghostW, pts, aspect).neededVFovDeg >
      DOWN_FIT.maxVFovDeg
    ) {
      return { eye: eyeAt(rig.behindM), target: ghostW, fovDeg: rig.fovDeg }
    }
    let lo = behind
    let hi = DOWN_FIT.maxBehindM
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      const f = fitDownView(eyeAt(mid), ghostW, pts, aspect)
      if (f.neededVFovDeg > DOWN_FIT.maxVFovDeg) lo = mid
      else {
        hi = mid
        fit = f
      }
    }
    behind = hi
  }
  const eye = eyeAt(behind)
  const fovDeg = Math.min(DOWN_FIT.maxVFovDeg, Math.max(rig.fovDeg, fit.neededVFovDeg))

  // When the FINAL FOV (rig floor, or horizontally-driven) leaves excess vertical room,
  // box-centring would hang the content mid-frame under empty space. Pitch down so the
  // content's centre sits ~28% above the frame middle — balls above centre, table
  // filling the lower view, only a sliver of room above — capped so nothing gets pushed
  // past 80% of the half-height. Vertically-tight fits are untouched.
  let look = fit.look
  const halfT = Math.tan((fovDeg * Math.PI) / 360)
  const right = new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize()
  const upV = new THREE.Vector3().crossVectors(right, look)
  const v = new THREE.Vector3()
  let yMinC = Number.POSITIVE_INFINITY
  let yMaxC = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    v.copy(p).sub(eye)
    const zc = v.dot(look)
    if (zc > 0.01) {
      const yt = v.dot(upV) / zc
      if (yt < yMinC) yMinC = yt
      if (yt > yMaxC) yMaxC = yt
    }
  }
  if (Number.isFinite(yMaxC)) {
    const shiftWant = 0.28 * halfT - (yMinC + yMaxC) / 2
    const shiftCap = (0.8 * halfT) / DOWN_FIT.margin - yMaxC
    const shift = Math.max(0, Math.min(shiftWant, shiftCap))
    if (shift > 0) look = look.clone().addScaledVector(upV, -shift).normalize()
  }

  const target = eye.clone().addScaledVector(look, 2)
  return { eye, target, fovDeg }
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
