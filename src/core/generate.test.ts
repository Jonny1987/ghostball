import { describe, expect, it } from 'vitest'
import { clampToReachable, ghostAt, reachableArc } from './constraint'
import { standingFrameCheck } from './framecheck'
import {
  GENERATOR_VERSION,
  generateShot,
  LEVELS,
  mulberry32,
  rungParams,
  spawnTheta,
} from './generate'
import { aimPoint, thetaTrue, trueGhost } from './ghost'
import { allowedWindow } from './score'
import { simulate } from './simulate'
import { buildTable, DEFAULT_TABLE, DEFAULT_TABLE_CONFIG } from './table'
import type { LevelId, Shot } from './types'
import { angleBetween, degToRad, dist, dot, normalize, radToDeg, sub, wrapToPi } from './vec'

const T = DEFAULT_TABLE
const cfg = T.cfg
const r = cfg.ballRadiusMm

const SHOTS_PER_LEVEL = 1000

function shots(level: LevelId, count = SHOTS_PER_LEVEL): Shot[] {
  const out: Shot[] = []
  for (let seed = 1; seed <= count; seed++) out.push(generateShot(seed, level, T))
  return out
}

describe('generator validity — 1000 seeded shots per level (§4.10, §7)', () => {
  for (const level of [1, 2, 3] as LevelId[]) {
    it(`level ${level}: every shot passes every §4.10 check (rung-aware)`, () => {
      const params = LEVELS[level]
      for (const s of shots(level)) {
        expect(s.gv).toBe(GENERATOR_VERSION)
        const p = rungParams(s.widenRung, params)
        // balls in bounds
        for (const b of [s.cue, s.object]) {
          expect(b.x).toBeGreaterThanOrEqual(r)
          expect(b.x).toBeLessThanOrEqual(cfg.tableLengthMm - r)
          expect(b.y).toBeGreaterThanOrEqual(r)
          expect(b.y).toBeLessThanOrEqual(cfg.tableWidthMm - r)
        }
        // check 1: O cushion clearance and |M−O| range, approach-angle generation cap
        const pk = T.pockets[s.pocketId]
        if (!pk) throw new Error('missing pocket')
        expect(s.object.x).toBeGreaterThanOrEqual(p.cushionClear - 1e-9)
        expect(s.object.x).toBeLessThanOrEqual(cfg.tableLengthMm - p.cushionClear + 1e-9)
        expect(s.object.y).toBeGreaterThanOrEqual(p.cushionClear - 1e-9)
        expect(s.object.y).toBeLessThanOrEqual(cfg.tableWidthMm - p.cushionClear + 1e-9)
        const dOP = dist(pk.m, s.object)
        expect(dOP).toBeGreaterThanOrEqual(p.dOPMin - 1e-9)
        expect(dOP).toBeLessThanOrEqual(params.dOP[1] + 1e-9)
        const alphaTrue = angleBetween(normalize(sub(aimPoint(pk, cfg), s.object)), pk.n)
        const genCap = pk.type === 'corner' ? 50 : 55
        expect(radToDeg(alphaTrue)).toBeLessThanOrEqual(genCap + 0.01)
        // pockets restricted to the level's set
        expect(params.pockets).toContain(s.pocketId)
        // check 2: G legal in bounds
        const G = trueGhost(s.object, pk, cfg)
        expect(G.x).toBeGreaterThanOrEqual(r)
        expect(G.x).toBeLessThanOrEqual(cfg.tableLengthMm - r)
        expect(G.y).toBeGreaterThanOrEqual(r)
        expect(G.y).toBeLessThanOrEqual(cfg.tableWidthMm - r)
        // check 3: distance minima; D > 2r
        const dCO = dist(s.cue, s.object)
        expect(dCO).toBeGreaterThanOrEqual(p.dCOMin - 1e-9)
        expect(dCO).toBeLessThanOrEqual(params.dCO[1] + 1e-9)
        expect(dist(s.cue, G)).toBeGreaterThanOrEqual(200 - 1e-9)
        expect(dCO).toBeGreaterThan(2 * r)
        // check 4: truth reachable
        expect(dot(sub(G, s.object), sub(s.cue, s.object))).toBeGreaterThan(4 * r * r)
        // check 5: cut angle within the level's range (both ends)
        expect(radToDeg(s.cutAngleTrue)).toBeLessThanOrEqual(params.cutDeg[1] + 0.02)
        expect(radToDeg(s.cutAngleTrue)).toBeGreaterThanOrEqual(params.cutDeg[0] - 0.02)
        // check 6: standing-frameability re-check with the rung's margin
        const arc = reachableArc(s.object, s.cue, T)
        const wantPocket =
          params.pocketFrame === 'hard' || (p.pocketPreferred && s.widenRung === 0)
            ? s.pocketId
            : null
        expect(
          standingFrameCheck(
            {
              cue: s.cue,
              object: s.object,
              arcThetaC: arc.thetaC,
              arcHalfWidth: arc.halfWidth,
              includePocketId: wantPocket,
              ndcMargin: p.ndcMargin,
            },
            T,
          ),
        ).toBe(true)
        // check 7: truth pots
        expect(simulate(s.thetaTrue, s.object, s.pocketId, T).outcome).toBe('target_pocket')
        // stored thetaTrue matches the geometry
        expect(Math.abs(wrapToPi(s.thetaTrue - thetaTrue(s.object, G)))).toBeLessThan(1e-9)
        // difficulty metadata present and sane
        expect(s.difficultyRaw).toBeGreaterThan(0)
        expect(Number.isFinite(s.difficultyRaw)).toBe(true)
      }
    })
  }

  // rung > 0 is unreachable for the default config within 500 attempts, so generated
  // shots cannot exercise the ladder — test its shape directly instead (review finding).
  it('the widening ladder has the exact §4.10 shape (tested directly)', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      const params = LEVELS[level]
      const r0 = rungParams(0, params)
      expect(r0.cushionClear).toBe(80)
      expect(r0.dOPMin).toBe(params.dOP[0])
      expect(r0.dCOMin).toBe(params.dCO[0])
      expect(r0.ndcMargin).toBe(0.9)
      expect(r0.pocketPreferred).toBe(params.pocketFrame === 'preferred')
      const r1 = rungParams(1, params)
      expect(r1.ndcMargin).toBe(1.0) // rung 1: frame margin relaxed, L2 preference dropped
      expect(r1.pocketPreferred).toBe(false)
      expect(r1.dOPMin).toBe(params.dOP[0]) // distances not yet relaxed
      const r2 = rungParams(2, params)
      expect(r2.dOPMin).toBeCloseTo(params.dOP[0] * 0.8, 9) // rung 2: minima −20 %
      expect(r2.dCOMin).toBeCloseTo(params.dCO[0] * 0.8, 9)
      expect(r2.cushionClear).toBe(80) // clearance not yet relaxed
      const r3 = rungParams(3, params)
      expect(r3.cushionClear).toBe(60) // rung 3: clearance 80 → 60
      // never widened: the level's cut range is not part of RungParams at all
    }
    // Document the empirical reality the review exposed: with default constraints the
    // generator always succeeds at rung 0 (validity checks above are rung-aware anyway).
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) expect(s.widenRung).toBe(0)
    }
  })

  it('spawnTheta jitters about the CUE LINE, not the answer (no answer leak, §1)', () => {
    const arcEpsDeg = 0.51
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) {
        const spawn = spawnTheta(s, T)
        // spawn is legal: clamping it is a no-op
        expect(clampToReachable(spawn, s.object, s.cue, T)).toBeCloseTo(spawn, 9)
        // relative to the cue line θC the offset is the jitter (or the arc/bounds clamp)
        const arc = reachableArc(s.object, s.cue, T)
        const offDeg = Math.abs(radToDeg(wrapToPi(spawn - arc.thetaC)))
        expect(offDeg).toBeLessThanOrEqual(30 + arcEpsDeg)
        // and it must NOT encode the truth: across the sample the spawn→truth distance
        // varies far outside the [15°, 30°] band a truth-jittered spawn would pin it to
      }
      const dists = shots(level, 60).map((s) =>
        Math.abs(radToDeg(wrapToPi(spawnTheta(s, T) - s.thetaTrue))),
      )
      const outsideBand = dists.filter((d) => d < 14 || d > 31).length
      expect(outsideBand).toBeGreaterThan(0)
    }
  })
})

describe('seed determinism (§4.10)', () => {
  it('same (seed, level) → identical shot, repeatedly', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const seed of [7, 42, 123456, 0xdeadbeef]) {
        const a = generateShot(seed, level, T)
        const b = generateShot(seed, level, T)
        expect(b).toEqual(a)
      }
    }
  })

  it('mulberry32 reference sequence is stable', () => {
    const rng = mulberry32(42)
    const seq = [rng(), rng(), rng()]
    const rng2 = mulberry32(42)
    expect([rng2(), rng2(), rng2()]).toEqual(seq)
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('different levels produce different shots for the same seed', () => {
    const a = generateShot(99, 1, T)
    const b = generateShot(99, 3, T)
    expect(a).not.toEqual(b)
  })
})

describe('perfect guess always pots (§7 property)', () => {
  it('submitting θ_true pots on 300 shots across levels', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) {
        expect(simulate(s.thetaTrue, s.object, s.pocketId, T).potted).toBe(true)
      }
    }
  })
})

describe('sensitivity test (§2.8): θ_true shift under AIM_DEPTH 0 → 20 mm', () => {
  it('95th percentile shift ≤ 1.5° per level', () => {
    const deepTable = buildTable({ ...DEFAULT_TABLE_CONFIG, aimDepthMm: 20 })
    for (const level of [1, 2, 3] as LevelId[]) {
      const shifts: number[] = []
      for (const s of shots(level)) {
        const pkDeep = deepTable.pockets[s.pocketId]
        if (!pkDeep) throw new Error('missing pocket')
        const gDeep = trueGhost(s.object, pkDeep, deepTable.cfg)
        const tDeep = thetaTrue(s.object, gDeep)
        shifts.push(radToDeg(Math.abs(wrapToPi(tDeep - s.thetaTrue))))
      }
      shifts.sort((a, b) => a - b)
      const p95 = shifts[Math.floor(shifts.length * 0.95)] ?? 0
      expect(p95).toBeLessThanOrEqual(1.5)
    }
  })
})

describe('clipped window vs dense sweep (§4.9 interval assumption)', () => {
  it('window matches a 0.02° sweep on 20 shots per level', () => {
    const step = degToRad(0.02)
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 20)) {
        const win = allowedWindow(s.thetaTrue, s.object, s.pocketId, T)
        for (const sign of [1, -1]) {
          // Sweep out from θ_true; find the last potting δ before the first miss.
          let lastPot = 0
          const limit = degToRad(Math.max(win.plusDeg, win.minusDeg) + 0.5)
          for (let d = step; d <= limit; d += step) {
            if (
              simulate(s.thetaTrue + sign * d, s.object, s.pocketId, T).outcome === 'target_pocket'
            ) {
              lastPot = d
            } else {
              break // interval assumption: first miss ends the potting set on this side
            }
          }
          const reported = degToRad(sign === 1 ? win.plusDeg : win.minusDeg)
          expect(Math.abs(lastPot - reported)).toBeLessThanOrEqual(degToRad(0.05))
        }
      }
    }
  })

  it('no pot→miss→pot alternation across the swept range (interval property)', () => {
    const step = degToRad(0.02)
    for (const s of shots(2, 20)) {
      for (const sign of [1, -1]) {
        let missSeen = false
        for (let d = step; d <= degToRad(4); d += step) {
          const pots =
            simulate(s.thetaTrue + sign * d, s.object, s.pocketId, T).outcome === 'target_pocket'
          if (!pots) missSeen = true
          else expect(missSeen).toBe(false)
        }
      }
    }
  })
})

describe('window narrows with distance (§7)', () => {
  it('same pocket, farther object ball → smaller window', () => {
    const pk = T.pockets[0]
    if (!pk) throw new Error('pocket 0 missing')
    const windowFor = (o: { x: number; y: number }) =>
      allowedWindow(thetaTrue(o, trueGhost(o, pk, cfg)), o, 0, T).windowDeg
    expect(windowFor({ x: 1800, y: 1100 })).toBeLessThan(windowFor({ x: 500, y: 500 }))
  })
})

describe('reachable arc is always non-degenerate on generated shots', () => {
  it('Δ > 5° on every generated shot', () => {
    for (const level of [1, 2, 3] as LevelId[]) {
      for (const s of shots(level, 100)) {
        const arc = reachableArc(s.object, s.cue, T)
        expect(radToDeg(arc.halfWidth)).toBeGreaterThan(5)
        // and the true ghost is inside the reachable arc
        const U = ghostAt(s.thetaTrue, s.object, r)
        expect(dot(sub(U, s.object), sub(s.cue, s.object))).toBeGreaterThan(4 * r * r)
      }
    }
  })
})
