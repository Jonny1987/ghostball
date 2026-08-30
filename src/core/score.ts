import { ghostAt } from './constraint'
import { cutAngle, trueGhost } from './ghost'
import { missMetrics, simulate } from './simulate'
import type { Band, ShotResult, SimResult, Table } from './types'
import { angleBetween, cross, degToRad, radToDeg, sub, type Vec2, wrapToPi } from './vec'

// contactFullness = 1 − sin(φ): fraction of the object ball the cue ball covers at contact (§4.9).
export function contactFullness(cutAngleRad: number): number {
  return 1 - Math.sin(cutAngleRad)
}

export type FullnessBand =
  | 'nearly full ball'
  | 'about ¾ ball'
  | 'about ½ ball'
  | 'about ¼ ball'
  | 'very thin'

export function fullnessBand(fullness: number): FullnessBand {
  if (fullness >= 0.85) return 'nearly full ball'
  if (fullness >= 0.6) return 'about ¾ ball'
  if (fullness >= 0.4) return 'about ½ ball'
  if (fullness >= 0.15) return 'about ¼ ball'
  return 'very thin'
}

// Grade bands, canonical degrees (§2.7).
export function gradeBand(thetaErrorDeg: number): Band {
  if (thetaErrorDeg <= 0.5) return 'perfect'
  if (thetaErrorDeg <= 1.5) return 'excellent'
  if (thetaErrorDeg <= 3) return 'good'
  if (thetaErrorDeg <= 6) return 'close'
  return 'miss'
}

export interface JawWindow {
  plus: number // β₊ toward E1, radians — jaw-subtended UPPER BOUND
  minus: number // β₋ toward E2
}

export function jawWindow(object: Vec2, targetPocketId: number, table: Table): JawWindow {
  const pk = table.pockets[targetPocketId]
  if (!pk) return { plus: 0, minus: 0 }
  const toM = sub(pk.m, object)
  return {
    plus: angleBetween(sub(pk.e1, object), toM),
    minus: angleBetween(sub(pk.e2, object), toM),
  }
}

export interface AllowedWindow {
  plusDeg: number // clipped against the simulator (§4.9)
  minusDeg: number
  windowDeg: number // min of the clipped sides
  clipped: boolean
}

const BISECT_TOL = degToRad(0.01)
const EDGE_EPS = degToRad(0.005)

// Clip each jaw-subtended side against the actual simulator (§4.9): near a rail, part of the
// window is shadowed by a cushion span. Assumes the potting set per side is an interval —
// property-tested against a dense sweep in the test suite.
export function allowedWindow(
  thetaTrueVal: number,
  object: Vec2,
  targetPocketId: number,
  table: Table,
): AllowedWindow {
  const pk = table.pockets[targetPocketId]
  if (!pk) return { plusDeg: 0, minusDeg: 0, windowDeg: 0, clipped: false }
  const jaw = jawWindow(object, targetPocketId, table)
  const pots = (theta: number): boolean =>
    simulate(theta, object, targetPocketId, table).outcome === 'target_pocket'

  if (!pots(thetaTrueVal)) {
    // Degenerate: the truth itself does not pot (excluded at generation by check 7).
    return { plusDeg: 0, minusDeg: 0, windowDeg: 0, clipped: true }
  }

  // d̂ rotates with θ, so rotating θ by +δ rotates the departure by +δ. The E1 side is the
  // rotation sign that turns d̂_true toward (E1 − O).
  const dTrue = { x: -Math.cos(thetaTrueVal), y: -Math.sin(thetaTrueVal) }
  const signPlus = cross(dTrue, sub(pk.e1, object)) >= 0 ? 1 : -1

  const clipSide = (beta: number, sign: number): number => {
    if (beta <= EDGE_EPS) return beta
    if (pots(thetaTrueVal + sign * (beta - EDGE_EPS))) return beta
    let lo = 0
    let hi = beta - EDGE_EPS
    while (hi - lo > BISECT_TOL) {
      const mid = (lo + hi) / 2
      if (pots(thetaTrueVal + sign * mid)) lo = mid
      else hi = mid
    }
    return lo
  }

  const plus = clipSide(jaw.plus, signPlus)
  const minus = clipSide(jaw.minus, -signPlus)
  const clipped = plus < jaw.plus - BISECT_TOL || minus < jaw.minus - BISECT_TOL
  return {
    plusDeg: radToDeg(plus),
    minusDeg: radToDeg(minus),
    windowDeg: radToDeg(Math.min(plus, minus)),
    clipped,
  }
}

export interface ScoreInput {
  thetaUser: number
  cue: Vec2
  object: Vec2
  targetPocketId: number
}

export interface FullResult extends ShotResult {
  sim: SimResult // event detail for the view layer (animation endpoint, rattle info)
  thetaTrue: number
}

// Assemble the complete §4.9 result payload for a submitted guess.
export function computeResult(input: ScoreInput, table: Table): FullResult {
  const { thetaUser, cue, object, targetPocketId } = input
  const { cfg } = table
  const r = cfg.ballRadiusMm
  const pk = table.pockets[targetPocketId]
  if (!pk) throw new Error(`no pocket ${targetPocketId}`)

  const ghost = trueGhost(object, pk, cfg)
  const tTrue = Math.atan2(ghost.y - object.y, ghost.x - object.x)
  const beta = Math.abs(wrapToPi(thetaUser - tTrue))
  const betaDeg = radToDeg(beta)

  const userGhost = ghostAt(thetaUser, object, r)
  const phiTrue = cutAngle(cue, ghost, object)
  const phiUser = cutAngle(cue, userGhost, object)

  const sim = simulate(thetaUser, object, targetPocketId, table)
  const miss = missMetrics(thetaUser, object, targetPocketId, table)
  const window = allowedWindow(tTrue, object, targetPocketId, table)

  const potEvent = sim.outcome === 'target_pocket' ? sim.event : null

  return {
    potted: sim.potted,
    outcome: sim.outcome,
    thetaErrorDeg: betaDeg,
    arcErrorMm: 2 * r * beta,
    contactErrorMm: r * beta,
    chordErrorMm: 4 * r * Math.sin(beta / 2),
    directionErrorDeg: betaDeg,
    cutAngleTrueDeg: radToDeg(phiTrue),
    cutAngleUserDeg: radToDeg(phiUser),
    overcut: phiUser > phiTrue,
    contactFullness: contactFullness(phiUser),
    allowedWindowDeg: window.windowDeg,
    windowPlusDeg: window.plusDeg,
    windowMinusDeg: window.minusDeg,
    windowClipped: window.clipped,
    mouthOffsetMm: potEvent?.mouthOffsetMm ?? miss.mouthOffsetMm,
    marginMm: potEvent?.marginMm ?? null,
    missMm: sim.potted ? null : miss.missMm,
    wrongDirection: miss.wrongDirection,
    cushionHit: sim.outcome === 'cushion' && sim.event ? sim.event.point : null,
    wrongPocketId: sim.outcome === 'wrong_pocket' ? sim.pocketId : null,
    band: gradeBand(betaDeg),
    sim,
    thetaTrue: tTrue,
  }
}
