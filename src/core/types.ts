import type { Vec2 } from './vec'

// All lengths in mm, all angles in radians unless a name says Deg (PLAN.md §4.1).

export interface TableConfig {
  tableLengthMm: number
  tableWidthMm: number
  ballRadiusMm: number
  cornerMouthMm: number
  sideMouthMm: number
  pocketSlopMm: number // tunable via §2.8 calibration
  alphaMaxRad: number // approach-angle capture cap, tunable via §2.8 calibration
  aimDepthMm: number // tunable knob, changes only G
}

export type PocketType = 'corner' | 'side'

export interface Pocket {
  id: number
  type: PocketType
  j1: Vec2 // jaw points on the boundary
  j2: Vec2
  m: Vec2 // mouth midpoint
  n: Vec2 // inward-pocket unit normal
  t: Vec2 // mouth tangent = perp(n), points from M toward J1
  wEff: number // effective mouth half-width = mouth/2 − r + pocketSlopMm (§4.4)
  e1: Vec2 // effective segment endpoints: E1 = M + wEff·t, E2 = M − wEff·t
  e2: Vec2
}

// One ball-centre track line per rail, inset by r from the boundary (§4.8).
// axis 'y' means the line is y = value (crossing coordinate is x), axis 'x' means x = value.
export interface TrackLine {
  axis: 'x' | 'y'
  value: number
  // Cushion spans of the crossing's other coordinate — jaw-bounded, NOT full rails (§4.8).
  spans: Array<[number, number]>
  // Mouth gaps: [lo, hi, pocketId] — a crossing here is a rattle candidate, never a cushion.
  gaps: Array<[number, number, number]>
}

export interface Table {
  cfg: TableConfig
  pockets: Pocket[]
  tracks: TrackLine[]
}

export type Outcome = 'target_pocket' | 'wrong_pocket' | 'cushion'

export interface SimEvent {
  kind: 'pot' | 'cushion' | 'rattle'
  t: number // mm along the ray
  point: Vec2
  pocketId?: number // pot and rattle events
  mouthOffsetMm?: number // pot events: signed offset u from M along t̂
  marginMm?: number // pot events: wEff − |u|
}

export interface SimResult {
  outcome: Outcome
  potted: boolean
  event: SimEvent | null // null only when the ray escapes every event (should not happen on-table)
  pocketId: number | null // pocket potted into (pot) or rattled (rattle), else null
  detail: 'rattled' | null
}

export type Band = 'perfect' | 'excellent' | 'good' | 'close' | 'miss'

export interface ShotResult {
  potted: boolean
  outcome: Outcome
  thetaErrorDeg: number
  arcErrorMm: number
  contactErrorMm: number
  chordErrorMm: number
  directionErrorDeg: number // ≡ thetaErrorDeg — the identity is stated in the UI
  cutAngleTrueDeg: number
  cutAngleUserDeg: number
  overcut: boolean // overcut = "too thin"
  contactFullness: number // 1 − sin(φ_user), §4.9
  allowedWindowDeg: number // clipped, §4.9
  windowPlusDeg: number // clipped per side
  windowMinusDeg: number
  windowClipped: boolean
  mouthOffsetMm: number | null
  marginMm: number | null
  missMm: number | null
  wrongDirection: boolean
  cushionHit: Vec2 | null
  wrongPocketId: number | null
  band: Band
}

export type LevelId = 1 | 2 | 3

export interface Shot {
  seed: number
  level: LevelId
  gv: number // generator version
  cue: Vec2 // C
  object: Vec2 // O
  pocketId: number
  thetaTrue: number
  cutAngleTrue: number
  difficultyRaw: number
  widenRung: number // 0 = no widening was needed
}
