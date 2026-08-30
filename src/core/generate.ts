import { reachableArc } from './constraint'
import { standingFrameCheck } from './framecheck'
import { aimPoint, cutAngle, thetaTrue, trueGhost } from './ghost'
import { jawWindow } from './score'
import { simulate } from './simulate'
import type { LevelId, Shot, Table } from './types'
import {
  add,
  angleBetween,
  degToRad,
  dist,
  dot,
  normalize,
  radToDeg,
  rotate,
  scale,
  sub,
  type Vec2,
} from './vec'

// Bumps on ANY change to the generator or its constants — calibration retuning included (§4.10).
export const GENERATOR_VERSION = 1

// Pinned PRNG (§4.10): mulberry32, reference implementation verbatim.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface LevelParams {
  cutDeg: [number, number]
  dCO: [number, number] // |C−O| range, mm
  dOP: [number, number] // |M−O| range, mm
  pockets: number[]
  pocketWeights: number[]
  pocketFrame: 'hard' | 'preferred' | 'none'
}

// Levels per §4.10: 1 Straight-ish, 2 Club (default), 3 Sharp.
export const LEVELS: Record<LevelId, LevelParams> = {
  1: {
    cutDeg: [0, 20],
    dCO: [400, 900],
    dOP: [300, 800],
    pockets: [0, 2, 3, 5],
    pocketWeights: [1, 1, 1, 1],
    pocketFrame: 'hard',
  },
  2: {
    cutDeg: [0, 55],
    dCO: [400, 1400],
    dOP: [300, 1400],
    pockets: [0, 1, 2, 3, 4, 5],
    pocketWeights: [1, 1, 1, 1, 1, 1],
    pocketFrame: 'preferred',
  },
  3: {
    cutDeg: [25, 80],
    dCO: [500, 2000],
    dOP: [400, 2000],
    pockets: [0, 1, 2, 3, 4, 5],
    pocketWeights: [1, 2, 1, 1, 2, 1], // biased to sides (§4.10)
    pocketFrame: 'none',
  },
}

const O_CUSHION_CLEAR = 80
const MIN_CG = 200
const APPROACH_CAP_CORNER = degToRad(50)
const APPROACH_CAP_SIDE = degToRad(55)
const RUNG0_ATTEMPTS = 500
const RUNG_ATTEMPTS = 200
const TABLE_L = 2540 // difficulty normalisation constant (§4.10 uses L)

export class GeneratorExhaustedError extends Error {
  constructor(seed: number, level: LevelId) {
    super(`shot generation exhausted the widening ladder (seed=${seed}, level=${level})`)
  }
}

interface RungParams {
  cushionClear: number
  dOPMin: number
  dCOMin: number
  ndcMargin: number
  pocketPreferred: boolean // Level-2 preference active
}

// Deterministic widening ladder (§4.10). Rung 0 = base constraints.
function rungParams(rung: number, level: LevelParams): RungParams {
  return {
    cushionClear: rung >= 3 ? 60 : O_CUSHION_CLEAR,
    dOPMin: rung >= 2 ? level.dOP[0] * 0.8 : level.dOP[0],
    dCOMin: rung >= 2 ? level.dCO[0] * 0.8 : level.dCO[0],
    ndcMargin: rung >= 1 ? 1.0 : 0.9,
    pocketPreferred: rung === 0 && level.pocketFrame === 'preferred',
  }
}

// A shot is fully determined by (seed, level, generatorVersion) (§4.10).
export function generateShot(seed: number, levelId: LevelId, table: Table): Shot {
  const level = LEVELS[levelId]
  const mixed =
    (seed ^ Math.imul(levelId, 0x9e3779b9) ^ Math.imul(GENERATOR_VERSION, 0x85ebca6b)) >>> 0
  const rng = mulberry32(mixed)
  const pick = (lo: number, hi: number): number => lo + (hi - lo) * rng()
  const totalWeight = level.pocketWeights.reduce((a, b) => a + b, 0)
  const pickPocket = (): number => {
    let roll = rng() * totalWeight
    for (let i = 0; i < level.pockets.length; i++) {
      roll -= level.pocketWeights[i] ?? 0
      if (roll <= 0) return level.pockets[i] ?? 0
    }
    return level.pockets[level.pockets.length - 1] ?? 0
  }

  const schedule: Array<{ rung: number; attempts: number }> = [
    { rung: 0, attempts: RUNG0_ATTEMPTS },
    { rung: 1, attempts: RUNG_ATTEMPTS },
    { rung: 2, attempts: RUNG_ATTEMPTS },
    { rung: 3, attempts: RUNG_ATTEMPTS },
  ]

  for (const { rung, attempts } of schedule) {
    const p = rungParams(rung, level)
    for (let i = 0; i < attempts; i++) {
      const shot = tryAttempt(rng, pick, pickPocket, p, rung, level, table)
      if (shot) {
        return { ...shot, seed, level: levelId, gv: GENERATOR_VERSION, widenRung: rung }
      }
    }
  }
  throw new GeneratorExhaustedError(seed, levelId)
}

function tryAttempt(
  rng: () => number,
  pick: (lo: number, hi: number) => number,
  pickPocket: () => number,
  p: RungParams,
  rung: number,
  level: LevelParams,
  table: Table,
): Omit<Shot, 'seed' | 'level' | 'gv' | 'widenRung'> | null {
  const { cfg } = table
  const L = cfg.tableLengthMm
  const W = cfg.tableWidthMm
  const r = cfg.ballRadiusMm

  // (1) pocket + O with cushion clearance, |M−O| in range, approach-angle cap.
  const pocketId = pickPocket()
  const pk = table.pockets[pocketId]
  if (!pk) return null
  const object: Vec2 = {
    x: pick(p.cushionClear, L - p.cushionClear),
    y: pick(p.cushionClear, W - p.cushionClear),
  }
  const dOP = dist(pk.m, object)
  if (dOP < p.dOPMin || dOP > level.dOP[1]) return null
  const target = aimPoint(pk, cfg)
  const alphaTrue = angleBetween(normalize(sub(target, object)), pk.n)
  const cap = pk.type === 'corner' ? APPROACH_CAP_CORNER : APPROACH_CAP_SIDE
  if (alphaTrue > cap) return null

  // (2) G legal in [r, L−r]×[r, W−r].
  const ghost = trueGhost(object, pk, cfg)
  if (ghost.x < r || ghost.x > L - r || ghost.y < r || ghost.y > W - r) return null

  // (3) place C at exactly the sampled cut angle: C = G + dist·R(±φ)·(G−P direction).
  const phi = degToRad(pick(level.cutDeg[0], level.cutDeg[1]))
  const side = rng() < 0.5 ? -1 : 1
  const away = normalize(sub(ghost, target)) // from pocket through G, i.e. −d̂_true
  const dCG = pick(Math.max(p.dCOMin, MIN_CG), level.dCO[1])
  const cue = add(ghost, scale(rotate(away, side * phi), dCG))
  if (cue.x < r || cue.x > L - r || cue.y < r || cue.y > W - r) return null
  const dCO = dist(cue, object)
  if (dCO < p.dCOMin || dCO > level.dCO[1]) return null
  if (dist(cue, ghost) < MIN_CG) return null
  // Balls must not overlap at the start.
  if (dCO < 2 * r + 1) return null

  // (4) truth reachable: dot(G−O, C−O) > 4r² — strict (§4.10).
  if (dot(sub(ghost, object), sub(cue, object)) <= 4 * r * r) return null

  // (5) φ_true within the level cap (by construction of C; re-check against numeric drift).
  const phiTrue = cutAngle(cue, ghost, object)
  if (radToDeg(phiTrue) > level.cutDeg[1] + 0.01) return null

  // (7) truth pots: simulate(θ_true) must return potted-in-target (§4.10 check 7).
  const tTrue = thetaTrue(object, ghost)
  if (simulate(tTrue, object, pocketId, table).outcome !== 'target_pocket') return null

  // (6) standing-frameability per the canonical rig (§4.10 check 6).
  const arc = reachableArc(object, cue, table)
  const wantPocket =
    level.pocketFrame === 'hard' || (p.pocketPreferred && rung === 0) ? pocketId : null
  const framed = standingFrameCheck(
    {
      cue,
      object,
      arcThetaC: arc.thetaC,
      arcHalfWidth: arc.halfWidth,
      includePocketId: wantPocket,
      ndcMargin: p.ndcMargin,
    },
    table,
  )
  if (!framed) return null

  // difficulty_raw = (2.0/Bd)·(1 + φ/90°)·(1 + |C−G|/L), Bd = unclipped jaw window (§4.10).
  const jaw = jawWindow(object, pocketId, table)
  const bd = radToDeg(Math.min(jaw.plus, jaw.minus))
  const difficultyRaw =
    (2.0 / Math.max(bd, 0.05)) * (1 + radToDeg(phiTrue) / 90) * (1 + dist(cue, ghost) / TABLE_L)

  return {
    cue,
    object,
    pocketId,
    thetaTrue: tTrue,
    cutAngleTrue: phiTrue,
    difficultyRaw,
  }
}
