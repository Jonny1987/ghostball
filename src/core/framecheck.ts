import type { Table } from './types'
import { degToRad, normalize, scale, sub, type Vec2 } from './vec'

// Canonical standing-check rig (PLAN.md §4.10): pure numbers, device-independent, used only
// by the generator's frameability check so ?seed= reproduces identically on every device.
// The runtime camera starts from the same pose but may dolly back per viewport (§5).
export const STANDING_RIG = {
  backMm: 1300, // eye is 1.3 m directly behind C on the cue line
  eyeHeightMm: 1620, // above the bed
  hFovDeg: 55,
  refViewportW: 390, // reference viewport: 390×844 portrait
  refViewportH: 844,
  ndcMargin: 0.9, // "framed with ≥5 % margin" = |ndc| ≤ 0.90 per axis
}

interface Vec3 {
  x: number
  y: number
  z: number
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z)
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

export interface StandingCamera {
  eye: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
  tanH: number
  tanV: number
}

// Eye at C − backMm·normalize(O − C) horizontally, at eyeHeightMm; look-at O at ball-centre
// height; zero roll; FOV fixed against the reference aspect (§4.10).
export function standingCheckCamera(cue: Vec2, object: Vec2, ballRadiusMm: number): StandingCamera {
  const dir = normalize(sub(object, cue))
  const back = scale(dir, -STANDING_RIG.backMm)
  const eye: Vec3 = { x: cue.x + back.x, y: cue.y + back.y, z: STANDING_RIG.eyeHeightMm }
  const target: Vec3 = { x: object.x, y: object.y, z: ballRadiusMm }
  const forward = norm3(sub3(target, eye))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  const right = norm3(cross3(forward, worldUp))
  const up = cross3(right, forward)
  const tanH = Math.tan(degToRad(STANDING_RIG.hFovDeg / 2))
  const tanV = tanH * (STANDING_RIG.refViewportH / STANDING_RIG.refViewportW)
  return { eye, forward, right, up, tanH, tanV }
}

// Project a world point to NDC; null when behind the camera.
export function projectNdc(cam: StandingCamera, p: Vec3): { x: number; y: number } | null {
  const v = sub3(p, cam.eye)
  const zc = dot3(v, cam.forward)
  if (zc <= 1) return null
  return { x: dot3(v, cam.right) / (zc * cam.tanH), y: dot3(v, cam.up) / (zc * cam.tanV) }
}

export interface FrameCheckInput {
  cue: Vec2
  object: Vec2
  arcThetaC: number
  arcHalfWidth: number
  includePocketId: number | null // pocket jaws + M required in frame (L1 hard / L2 preferred)
  ndcMargin: number // 0.90 at rung 0; relaxed to 1.00 by the widening ladder
}

// Generator check 6 (§4.10): C, O, and the full reachable arc (sampled every ≤5°) must project
// inside |ndc| ≤ margin; plus the target pocket's J1/J2/M where pocket-frameability applies.
export function standingFrameCheck(input: FrameCheckInput, table: Table): boolean {
  const r = table.cfg.ballRadiusMm
  const cam = standingCheckCamera(input.cue, input.object, r)
  const margin = input.ndcMargin

  const ok = (p: Vec3): boolean => {
    const ndc = projectNdc(cam, p)
    return ndc !== null && Math.abs(ndc.x) <= margin && Math.abs(ndc.y) <= margin
  }

  const points: Vec3[] = [
    { x: input.cue.x, y: input.cue.y, z: r },
    { x: input.object.x, y: input.object.y, z: r },
  ]
  const step = degToRad(5)
  const n = Math.max(2, Math.ceil((2 * input.arcHalfWidth) / step))
  for (let i = 0; i <= n; i++) {
    const theta = input.arcThetaC - input.arcHalfWidth + (2 * input.arcHalfWidth * i) / n
    points.push({
      x: input.object.x + 2 * r * Math.cos(theta),
      y: input.object.y + 2 * r * Math.sin(theta),
      z: r,
    })
  }
  if (input.includePocketId !== null) {
    const pk = table.pockets[input.includePocketId]
    if (pk) {
      points.push({ x: pk.j1.x, y: pk.j1.y, z: 0 })
      points.push({ x: pk.j2.x, y: pk.j2.y, z: 0 })
      points.push({ x: pk.m.x, y: pk.m.y, z: 0 })
    }
  }
  return points.every(ok)
}
