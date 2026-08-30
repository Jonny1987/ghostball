import type { Table } from './types'
import {
  ARC_EPS,
  add,
  clamp,
  degToRad,
  EPS,
  len,
  scale,
  sub,
  unit,
  type Vec2,
  wrapToPi,
} from './vec'

// U(θ) = O + 2r·ê(θ) — the constraint circle (§4.6).
export function ghostAt(theta: number, object: Vec2, ballRadiusMm: number): Vec2 {
  return add(object, scale(unit(theta), 2 * ballRadiusMm))
}

export interface ReachableArc {
  thetaC: number // angle of the O→C direction
  halfWidth: number // Δ, already shrunk by ARC_EPS; 0 when D is degenerate-close to 2r
}

// Reachable ⟺ ψ < Δ = arccos(2r/D) about the O→C direction — the 4r² condition,
// NOT the naive facing half-circle (derivation in PLAN.md §4.6).
export function reachableArc(object: Vec2, cue: Vec2, table: Table): ReachableArc {
  const c = sub(cue, object)
  const d = len(c) // domain: caller guarantees D > 2r
  const r2 = 2 * table.cfg.ballRadiusMm
  // max(0,·): for D within ~2 µm of 2r the raw value goes negative; Δ = 0 ⇒ θ' = θC (§4.7).
  const halfWidth = Math.max(0, Math.acos(clamp(r2 / d, -1, 1)) - ARC_EPS)
  return { thetaC: Math.atan2(c.y, c.x), halfWidth }
}

const BOUNDS_STEP = degToRad(0.25)

// Clamp θ to the reachable arc, then walk back toward θC until U is inside table bounds (§4.7).
export function clampToReachable(theta: number, object: Vec2, cue: Vec2, table: Table): number {
  const { cfg } = table
  const r = cfg.ballRadiusMm
  const { thetaC, halfWidth } = reachableArc(object, cue, table)
  let delta = clamp(wrapToPi(theta - thetaC), -halfWidth, halfWidth)
  let thetaP = wrapToPi(thetaC + delta)

  const inBounds = (t: number): boolean => {
    const u = ghostAt(t, object, r)
    return u.x >= r && u.x <= cfg.tableLengthMm - r && u.y >= r && u.y <= cfg.tableWidthMm - r
  }

  while (!inBounds(thetaP) && Math.abs(delta) > 0) {
    delta -= Math.sign(delta) * Math.min(Math.abs(delta), BOUNDS_STEP)
    thetaP = wrapToPi(thetaC + delta)
  }
  return thetaP
}

// Exact radial projection of a drag point onto the constraint circle, then clamp (§4.7).
export function placeFromDrag(
  point: Vec2,
  object: Vec2,
  cue: Vec2,
  prevTheta: number,
  table: Table,
): number {
  const v = sub(point, object)
  if (len(v) < EPS) return prevTheta // finger over O
  return clampToReachable(Math.atan2(v.y, v.x), object, cue, table)
}

export interface NudgeResult {
  theta: number
  atLimit: boolean // the step was fully absorbed by the clamp
}

// Nudge by a signed step in θ; fine 0.25°, coarse 1.0° (screen-space sign resolution is a
// view-layer concern — core takes the already-resolved signed step) (§4.7).
export function nudge(
  theta: number,
  signedStep: number,
  object: Vec2,
  cue: Vec2,
  table: Table,
): NudgeResult {
  const target = wrapToPi(theta + signedStep)
  const clamped = clampToReachable(target, object, cue, table)
  const moved = Math.abs(wrapToPi(clamped - theta))
  return { theta: clamped, atLimit: moved < Math.abs(signedStep) * 0.5 }
}

export const FINE_STEP = degToRad(0.25)
export const COARSE_STEP = degToRad(1.0)

// ---------------------------------------------------------------------------
// V2 free placement (design change 2026-08-30, docs/decisions.md): the ghost is no
// longer constrained to the touching circle. The guess is a full 2D position — it may
// overlap the object ball or sit short of it (judging the touching distance is part of
// the skill). Placement is bounded to a region around O so a wrong guess stays in frame.

// Max ghost-centre distance from O: touching (2r) plus one full ball diameter of gap.
export const MAX_CENTER_DIST_FACTOR = 2 // × 2r
export function maxCenterDistMm(ballRadiusMm: number): number {
  return MAX_CENTER_DIST_FACTOR * 2 * ballRadiusMm
}

// Radius of the region the camera must keep fully visible around O: the whole placement
// disc plus the ball itself plus a slight margin (§ zoom framing).
export function frameRadiusMm(ballRadiusMm: number): number {
  return maxCenterDistMm(ballRadiusMm) + ballRadiusMm + 15
}

// Clamp a desired ghost-centre position: radially to the placement disc around O, then
// to the table bounds. Overlap with O (any distance ≥ 0) is allowed.
export function clampPlacement(p: Vec2, object: Vec2, table: Table): Vec2 {
  const { cfg } = table
  const r = cfg.ballRadiusMm
  const maxDist = maxCenterDistMm(r)
  let x = p.x
  let y = p.y
  const dx = x - object.x
  const dy = y - object.y
  const d = Math.hypot(dx, dy)
  if (d > maxDist) {
    x = object.x + (dx / d) * maxDist
    y = object.y + (dy / d) * maxDist
  }
  x = clamp(x, r, cfg.tableLengthMm - r)
  y = clamp(y, r, cfg.tableWidthMm - r)
  return { x, y }
}

export interface NudgePosResult {
  pos: Vec2
  atLimit: boolean
}

// 2D nudge by a table-space delta (screen-aligned directions resolved by the view layer).
export function nudgePos(pos: Vec2, delta: Vec2, object: Vec2, table: Table): NudgePosResult {
  const target = { x: pos.x + delta.x, y: pos.y + delta.y }
  const clamped = clampPlacement(target, object, table)
  const moved = Math.hypot(clamped.x - pos.x, clamped.y - pos.y)
  const want = Math.hypot(delta.x, delta.y)
  return { pos: clamped, atLimit: moved < want * 0.5 }
}

// mm-based nudge steps (the "Perfect" band is ±0.5 mm; 1° of the old arc ≈ 1 mm).
export const FINE_STEP_MM = 0.25
export const COARSE_STEP_MM = 1.0
