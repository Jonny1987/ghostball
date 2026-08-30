import type { Pocket, TableConfig } from './types'
import { add, angleBetween, normalize, scale, sub, type Vec2 } from './vec'

// Aim point in the pocket: P_target = M + aimDepthMm · n̂ (§4.5; default aimDepth 0).
export function aimPoint(pocket: Pocket, cfg: TableConfig): Vec2 {
  return add(pocket.m, scale(pocket.n, cfg.aimDepthMm))
}

// True ghost: G = O − 2r · normalize(P_target − O); |G−O| = 2r by construction (§4.5).
export function trueGhost(object: Vec2, pocket: Pocket, cfg: TableConfig): Vec2 {
  const p = aimPoint(pocket, cfg)
  const d = normalize(sub(p, object))
  return sub(object, scale(d, 2 * cfg.ballRadiusMm))
}

export function thetaTrue(object: Vec2, ghost: Vec2): number {
  return Math.atan2(ghost.y - object.y, ghost.x - object.x)
}

// Cut angle φ = angleBetween(G − C, O − G); 0 = straight, →90° = graze (§4.5).
export function cutAngle(cue: Vec2, ghost: Vec2, object: Vec2): number {
  return angleBetween(sub(ghost, cue), sub(object, ghost))
}

// Object-ball departure direction for a ghost at U: d̂ = normalize(O − U) (§4.8).
export function departureDir(object: Vec2, ghostPos: Vec2): Vec2 {
  return normalize(sub(object, ghostPos))
}
