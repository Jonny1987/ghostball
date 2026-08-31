import { clampPlacement, frameRadiusMm, maxCenterDistMm } from './constraint'
import type { Table } from './types'
import { normalize, radToDeg, scale, sub, type Vec2 } from './vec'

// V2 zoom framing (docs/decisions.md): the standing view zooms in as far as possible
// while keeping the TARGET POCKET, the OBJECT BALL'S PLACEMENT REGION and (v2.4) the
// CUE BALL fully visible — the shooter sees their own ball and cue at the bottom of the
// frame, the ghost mid-frame and the pocket up top, like standing at the real table.
//
// This module is pure math shared by BOTH the generator's frameability check (canonical
// eye + reference aspect, so ?seed= stays device-independent) and the runtime camera
// (same fit at the actual viewport aspect) — the two cannot disagree by construction.

export const STANDING_RIG = {
  backMm: 1300, // eye is 1.3 m directly behind C on the cue line
  eyeHeightMm: 1620, // above the bed
  refAspect: 390 / 844, // reference viewport (portrait) for the generation-time check
  minVFovDeg: 10, // max zoom-in
  maxVFovDeg: 74, // beyond this the view distorts; unfittable shots are rejected
  fitMargin: 1.12, // slight margin around the required region
  // fraction of the screen height reserved top AND bottom so required points clear the
  // HUD (stance pill up top, submit bar at the bottom where the cue ball now sits)
  vPadFrac: 0.12,
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

// Points the standing view must frame: the target pocket mouth, the full placement
// region around O (ghost fully visible even at the max allowed misplacement), and
// (v2.4) the cue ball with its full extents.
function requiredPoints(cue: Vec2, object: Vec2, pocketId: number, table: Table): Vec3[] {
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
  pts.push({ x: cue.x, y: cue.y, z: 0 }, { x: cue.x, y: cue.y, z: 2 * r })
  pts.push({ x: cue.x + r, y: cue.y, z: r }, { x: cue.x - r, y: cue.y, z: r })
  pts.push({ x: cue.x, y: cue.y + r, z: r }, { x: cue.x, y: cue.y - r, z: r })
  return pts
}

// Standing fit (v2.7 — same construction as the down view, from standing height): the
// eye sits on the CUE→GHOST line, backMm behind the cue ball, and the look's horizontal
// azimuth is LOCKED to that line. Eye, cue ball and ghost then share one vertical
// plane, so the CUE BALL and the GHOST both project to the horizontal screen centre for
// any pitch — moving the ghost orbits the camera around the cue ball, exactly like the
// down view. Only the pitch is fitted (vertical box centring with the HUD pad) plus the
// smallest FOV that still contains every required point. Without a ghost the aim runs
// through O (the canonical, generation-time rig).
export function fitStandingZoom(
  cue: Vec2,
  object: Vec2,
  pocketId: number,
  table: Table,
  aspect: number,
  fitMargin = STANDING_RIG.fitMargin,
  ghostPos?: Vec2,
): StandingFit {
  const r = table.cfg.ballRadiusMm
  const aimTo = ghostPos ?? object
  const dir = normalize(sub(aimTo, cue))
  const back = scale(dir, -STANDING_RIG.backMm)
  const eye: Vec3 = { x: cue.x + back.x, y: cue.y + back.y, z: STANDING_RIG.eyeHeightMm }
  const pts = requiredPoints(cue, object, pocketId, table)

  // Initial forward points from the eye at the aim target at ball height — its
  // horizontal azimuth IS the aim line (the eye lies on it), and the vertical-only
  // steering below never changes that azimuth: right = forward × worldUp is the same
  // horizontal vector at any pitch, and up-steering keeps forward in the aim plane.
  let forward = norm3(sub3({ x: aimTo.x, y: aimTo.y, z: r }, eye))
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 }
  let tanH = 0
  let tanV = 0

  for (let iter = 0; iter < 2; iter++) {
    const right = norm3(cross3(forward, worldUp))
    const up = cross3(right, forward)
    let yMin = Number.POSITIVE_INFINITY
    let yMax = Number.NEGATIVE_INFINITY
    let tanHMax = 0
    for (const p of pts) {
      const v = sub3(p, eye)
      const zc = dot3(v, forward)
      if (zc <= 1) continue // degenerate; ignore (cannot happen for on-table points)
      const d = Math.abs(dot3(v, right) / zc)
      if (d > tanHMax) tanHMax = d
      const yt = dot3(v, up) / zc
      if (yt < yMin) yMin = yt
      if (yt > yMax) yMax = yt
    }
    tanH = tanHMax * fitMargin
    // vertical band pad: content occupies the middle (1 − 2·vPadFrac) of the screen so
    // the pocket clears the stance pill and the cue ball clears the submit bar (v2.4)
    tanV = (((yMax - yMin) / 2) * fitMargin) / (1 - 2 * STANDING_RIG.vPadFrac)
    forward = norm3(add3(forward, scale3(up, (yMin + yMax) / 2)))
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

// Generator check 6 (v2, hardened v2.7): the rig at the reference aspect must fit the
// pocket + placement region + cue ball within the max FOV — for the canonical aim AND
// with the eye swung to eight extreme ghost placements, since the eye now orbits with
// the ghost. Hard for every level: every legal placement keeps the pocket visible.
export function standingFrameCheck(
  cue: Vec2,
  object: Vec2,
  pocketId: number,
  table: Table,
  fitMargin = STANDING_RIG.fitMargin,
): boolean {
  if (!fitStandingZoom(cue, object, pocketId, table, STANDING_RIG.refAspect, fitMargin).fits) {
    return false
  }
  const d = maxCenterDistMm(table.cfg.ballRadiusMm)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI
    const g = clampPlacement(
      { x: object.x + d * Math.cos(a), y: object.y + d * Math.sin(a) },
      object,
      table,
    )
    if (!fitStandingZoom(cue, object, pocketId, table, STANDING_RIG.refAspect, fitMargin, g).fits) {
      return false
    }
  }
  return true
}
