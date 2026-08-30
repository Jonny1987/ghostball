import { frameRadiusMm } from './constraint'
import type { Table } from './types'
import { normalize, radToDeg, scale, sub, type Vec2 } from './vec'

// V2 zoom framing (docs/decisions.md): the standing view zooms in as far as possible
// while keeping the TARGET POCKET and the OBJECT BALL'S PLACEMENT REGION fully visible
// (the whole disc the ghost can be dragged over, plus a slight margin). The cue ball no
// longer needs to be in frame — the camera sits on the cue line, so the perspective
// itself carries the shooting direction.
//
// This module is pure math shared by BOTH the generator's frameability check (canonical
// eye + reference aspect, so ?seed= stays device-independent) and the runtime camera
// (same fit at the actual viewport aspect) — the two cannot disagree by construction.

export const STANDING_RIG = {
  backMm: 1300, // eye is 1.3 m directly behind C on the cue line
  eyeHeightMm: 1620, // above the bed
  refAspect: 390 / 844, // reference viewport (portrait) for the generation-time check
  minVFovDeg: 10, // max zoom-in
  maxVFovDeg: 70, // beyond this the view distorts; unfittable shots are rejected
  fitMargin: 1.12, // slight margin around the required region
}

interface Vec3 {
  x: number
  y: number
  z: number
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
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

export interface StandingFit {
  eye: Vec3 // mm, z up from the bed
  look: Vec3 // unit look direction
  vFovDeg: number // clamped for use
  neededVFovDeg: number // unclamped requirement
  fits: boolean // neededVFovDeg ≤ maxVFovDeg
}

// Points the standing view must frame: the target pocket mouth and the full placement
// region around O (ghost fully visible even at the max allowed misplacement).
function requiredPoints(object: Vec2, pocketId: number, table: Table): Vec3[] {
  const r = table.cfg.ballRadiusMm
  const pts: Vec3[] = [{ x: object.x, y: object.y, z: r }]
  const pk = table.pockets[pocketId]
  if (pk) {
    pts.push({ x: pk.j1.x, y: pk.j1.y, z: 0 })
    pts.push({ x: pk.j2.x, y: pk.j2.y, z: 0 })
    pts.push({ x: pk.m.x, y: pk.m.y, z: 0 })
  }
  const fr = frameRadiusMm(r)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI
    const x = object.x + fr * Math.cos(a)
    const y = object.y + fr * Math.sin(a)
    pts.push({ x, y, z: 0 })
    pts.push({ x, y, z: 2 * r }) // ball top — the ghost must be FULLY visible
  }
  return pts
}

// Max-zoom fit: gnomonic-project the required points from the eye, centre the look
// direction on their bounding box, and take the smallest FOV that contains it (two
// recentering iterations make the first-order approximation exact enough).
export function fitStandingZoom(
  cue: Vec2,
  object: Vec2,
  pocketId: number,
  table: Table,
  aspect: number,
  fitMargin = STANDING_RIG.fitMargin,
): StandingFit {
  const r = table.cfg.ballRadiusMm
  const dir = normalize(sub(object, cue))
  const back = scale(dir, -STANDING_RIG.backMm)
  const eye: Vec3 = { x: cue.x + back.x, y: cue.y + back.y, z: STANDING_RIG.eyeHeightMm }
  const pts = requiredPoints(object, pocketId, table)

  let forward = norm3(sub3({ x: object.x, y: object.y, z: r }, eye))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  let tanH = 0
  let tanV = 0

  for (let iter = 0; iter < 2; iter++) {
    const right = norm3(cross3(forward, worldUp))
    const up = cross3(right, forward)
    let xMin = Number.POSITIVE_INFINITY
    let xMax = Number.NEGATIVE_INFINITY
    let yMin = Number.POSITIVE_INFINITY
    let yMax = Number.NEGATIVE_INFINITY
    for (const p of pts) {
      const v = sub3(p, eye)
      const zc = dot3(v, forward)
      if (zc <= 1) continue // degenerate; ignore (cannot happen for on-table points)
      const xt = dot3(v, right) / zc
      const yt = dot3(v, up) / zc
      if (xt < xMin) xMin = xt
      if (xt > xMax) xMax = xt
      if (yt < yMin) yMin = yt
      if (yt > yMax) yMax = yt
    }
    const cx = (xMin + xMax) / 2
    const cy = (yMin + yMax) / 2
    tanH = ((xMax - xMin) / 2) * fitMargin
    tanV = ((yMax - yMin) / 2) * fitMargin
    forward = norm3(add3(forward, add3(scale3(right, cx), scale3(up, cy))))
  }

  const neededV = 2 * radToDeg(Math.atan(Math.max(tanV, tanH / aspect)))
  const vFovDeg = Math.min(STANDING_RIG.maxVFovDeg, Math.max(STANDING_RIG.minVFovDeg, neededV))
  return {
    eye,
    look: forward,
    vFovDeg,
    neededVFovDeg: neededV,
    fits: neededV <= STANDING_RIG.maxVFovDeg,
  }
}

// Generator check 6 (v2): the canonical rig at the reference aspect must fit the pocket
// + placement region within the max FOV. Hard for every level — the pocket is always
// visible in the standing view by construction.
export function standingFrameCheck(
  cue: Vec2,
  object: Vec2,
  pocketId: number,
  table: Table,
  fitMargin = STANDING_RIG.fitMargin,
): boolean {
  return fitStandingZoom(cue, object, pocketId, table, STANDING_RIG.refAspect, fitMargin).fits
}
